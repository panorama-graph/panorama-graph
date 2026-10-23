import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { AuthConfig } from "../src/auth/config";
import { Signer } from "../src/auth/session";
import { createTestDb, silentLogger } from "./setup";

const db = createTestDb();
const CONSOLE = "http://localhost:5180";
const INGEST_TOKEN = "token-de-ingestao-de-teste";

/** Provedor OIDC falso: descoberta, chaves, token (o código "codigo-valido") e logout. */
class FakeIdp {
  issuer = "";
  nonce = "";
  private server!: Server;
  private key!: CryptoKey;
  private jwk!: object;

  async start() {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    this.key = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    this.server = createServer((req, res) => void this.handle(req.url ?? "", req, res));
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  sign(claims: Record<string, unknown>, opts: { audience: string; issuer?: string; expiresIn?: string }) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.issuer ?? this.issuer)
      .setAudience(opts.audience)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "5m")
      .sign(this.key);
  }

  private async handle(url: string, req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
    const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (url === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        end_session_endpoint: `${this.issuer}/logout`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url === "/jwks") return json(200, { keys: [this.jwk] });
    if (url === "/token") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      if (form.get("code") !== "codigo-valido" || !form.get("code_verifier")) return json(400, { error: "invalid_grant" });
      const idToken = await this.sign(
        { sub: "pessoa-1", name: "Maria Silva", email: "maria@example.com", groups: ["arquitetura", "plataforma"], nonce: this.nonce },
        { audience: "panorama" },
      );
      return json(200, { access_token: "at", token_type: "Bearer", expires_in: 300, id_token: idToken });
    }
    return json(404, {});
  }
}

const idp = new FakeIdp();
const apps: FastifyInstance[] = [];

async function app(auth: AuthConfig) {
  const a = await buildApp({ db, logger: silentLogger, corsOrigins: [CONSOLE], auth });
  apps.push(a);
  return a;
}

function ssoConfig(): AuthConfig {
  return {
    sso: {
      issuer: idp.issuer,
      allowHttp: false,
      clientId: "panorama",
      clientSecret: "segredo",
      scopes: "openid profile email",
      groupsClaim: "groups",
      publicUrl: "http://localhost:3200",
      sessionSecret: "x".repeat(32),
      sessionTtlSeconds: 3600,
      sameSite: "lax",
    },
    jwt: { issuers: [idp.issuer], audience: "panorama-graph", groupsClaim: "groups" },
  };
}

const cookieOf = (setCookie: string | string[] | undefined, name: string) =>
  [setCookie ?? []].flat().find((c) => c.startsWith(`${name}=`))?.split(";")[0];

beforeAll(() => idp.start());
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await idp.stop();
  await db.close();
});

describe("modo anônimo", () => {
  test("sem SSO, toda requisição é da identidade anônima, e o login não existe", async () => {
    const a = await app({});
    expect((await a.inject({ method: "GET", url: "/v1/auth/me" })).json()).toEqual({
      mode: "anonymous",
      identity: { kind: "anonymous", subject: "anonymous", name: "Anônimo", groups: [] },
    });
    expect((await a.inject({ method: "GET", url: "/v1/schema" })).statusCode).toBe(200);
    expect((await a.inject({ method: "POST", url: "/v1/ingest", payload: {} })).statusCode).toBe(400); // passou do guarda
    expect((await a.inject({ method: "GET", url: "/v1/auth/login" })).statusCode).toBe(404);
  });

  test("com INGEST_TOKEN, a leitura segue aberta e a escrita exige o token", async () => {
    const a = await app({ ingestToken: INGEST_TOKEN });
    expect((await a.inject({ method: "GET", url: "/v1/schema" })).statusCode).toBe(200);

    const denied = await a.inject({ method: "POST", url: "/v1/ingest", payload: {} });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({ code: "unauthorized", status: 401 });
    expect(denied.headers["www-authenticate"]).toContain("Bearer");
    expect((await a.inject({ method: "POST", url: "/v1/nodes/merge", payload: {} })).statusCode).toBe(401);

    const ok = await a.inject({ method: "POST", url: "/v1/ingest", payload: {}, headers: { authorization: `Bearer ${INGEST_TOKEN}` } });
    expect(ok.statusCode).toBe(400);

    const wrong = await a.inject({ method: "GET", url: "/v1/schema", headers: { authorization: "Bearer outro-token-qualquer" } });
    expect(wrong.statusCode).toBe(401);
    expect((await a.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("SSO", () => {
  test("sem sessão, só o público responde; o 401 do console vem com CORS para o navegador ler", async () => {
    const a = await app(ssoConfig());
    expect((await a.inject({ method: "GET", url: "/v1/auth/me" })).json()).toEqual({ mode: "sso", identity: null });
    expect((await a.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await a.inject({ method: "GET", url: "/v1/openapi.json" })).statusCode).toBe(200);
    expect((await a.inject({ method: "GET", url: "/v1/schema" })).statusCode).toBe(401);
    expect((await a.inject({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(401);

    const query = await a.inject({ method: "POST", url: "/v1/queries/people_list", payload: {}, headers: { origin: CONSOLE } });
    expect(query.statusCode).toBe(401);
    expect(query.headers["access-control-allow-origin"]).toBe(CONSOLE);
    expect(query.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("login: vai ao provedor com PKCE, volta com a sessão e a pessoa com os grupos", async () => {
    const a = await app(ssoConfig());
    const start = await a.inject({ method: "GET", url: `/v1/auth/login?returnTo=${encodeURIComponent(`${CONSOLE}/componentes`)}` });
    expect(start.statusCode).toBe(302);
    const authorize = new URL(start.headers.location as string);
    expect(authorize.origin + authorize.pathname).toBe(`${idp.issuer}/authorize`);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: "panorama",
      redirect_uri: "http://localhost:3200/v1/auth/callback",
      response_type: "code",
      code_challenge_method: "S256",
      scope: "openid profile email",
    });
    const login = cookieOf(start.headers["set-cookie"], "pg_login")!;
    expect(start.headers["set-cookie"]).toEqual(expect.arrayContaining([expect.stringContaining("HttpOnly")]));

    idp.nonce = authorize.searchParams.get("nonce")!;
    const state = authorize.searchParams.get("state")!;
    const back = await a.inject({ method: "GET", url: `/v1/auth/callback?code=codigo-valido&state=${state}`, headers: { cookie: login } });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe(`${CONSOLE}/componentes`);
    const session = cookieOf(back.headers["set-cookie"], "pg_session")!;
    expect(session).toBeDefined();

    expect((await a.inject({ method: "GET", url: "/v1/schema", headers: { cookie: session } })).statusCode).toBe(200);
    expect((await a.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: session } })).json()).toEqual({
      mode: "sso",
      identity: { kind: "person", subject: "pessoa-1", issuer: idp.issuer, name: "Maria Silva", email: "maria@example.com", groups: ["arquitetura", "plataforma"] },
    });

    // A sessão adulterada não vale.
    const forged = session.replace(/^pg_session=./, (m) => m.slice(0, -1) + (m.endsWith("A") ? "B" : "A"));
    expect((await a.inject({ method: "GET", url: "/v1/schema", headers: { cookie: forged } })).statusCode).toBe(401);
  });

  test("volta do provedor que não confere: para o console com a mensagem, sem sessão", async () => {
    const a = await app(ssoConfig());
    const start = await a.inject({ method: "GET", url: "/v1/auth/login" });
    const login = cookieOf(start.headers["set-cookie"], "pg_login")!;
    const back = await a.inject({ method: "GET", url: "/v1/auth/callback?code=codigo-valido&state=outro", headers: { cookie: login } });
    expect(back.statusCode).toBe(302);
    const to = new URL(back.headers.location as string);
    expect(to.origin).toBe(CONSOLE);
    expect(to.searchParams.get("loginError")).toBeTruthy();
    expect(cookieOf(back.headers["set-cookie"], "pg_session")).toBeUndefined();

    const expired = await a.inject({ method: "GET", url: "/v1/auth/callback?code=codigo-valido&state=x" });
    expect(new URL(expired.headers.location as string).searchParams.get("loginError")).toContain("Entre de novo");
  });

  test("returnTo de outra origem é ignorado: volta para o console", async () => {
    const a = await app(ssoConfig());
    const start = await a.inject({ method: "GET", url: "/v1/auth/logout?returnTo=https%3A%2F%2Fmalicioso.example%2F" });
    const end = new URL(start.headers.location as string);
    expect(end.origin + end.pathname).toBe(`${idp.issuer}/logout`);
    expect(end.searchParams.get("post_logout_redirect_uri")).toBe(CONSOLE);
    expect(end.searchParams.get("client_id")).toBe("panorama");
    expect(cookieOf(start.headers["set-cookie"], "pg_session")).toBe("pg_session=");
  });

  test("token de serviço: JWT de emissor confiável e com a audiência certa", async () => {
    const a = await app(ssoConfig());
    const bearer = async (token: string) =>
      (await a.inject({ method: "GET", url: "/v1/schema", headers: { authorization: `Bearer ${token}` } })).statusCode;
    expect(await bearer(await idp.sign({ sub: "ci:catalogo" }, { audience: "panorama-graph" }))).toBe(200);
    expect(await bearer(await idp.sign({ sub: "ci:catalogo" }, { audience: "outra-api" }))).toBe(401);
    expect(await bearer(await idp.sign({ sub: "ci:catalogo" }, { audience: "panorama-graph", issuer: "https://desconhecido.example" }))).toBe(401);
    expect(await bearer(await idp.sign({ sub: "ci:catalogo" }, { audience: "panorama-graph", expiresIn: "-1m" }))).toBe(401);
    expect(await bearer("nao-e-jwt")).toBe(401);
  });
});

describe("Signer", () => {
  test("recusa valor adulterado, de outro segredo ou vencido", () => {
    const signer = new Signer("a".repeat(32));
    const value = signer.sign({ x: 1 }, 60);
    expect(signer.verify<{ x: number }>(value)?.x).toBe(1);
    expect(signer.verify(value.replace(/\.(.)/, (_, c) => `.${c === "a" ? "b" : "a"}`))).toBeNull();
    expect(new Signer("b".repeat(32)).verify(value)).toBeNull();
    expect(signer.verify(signer.sign({ x: 1 }, -1))).toBeNull();
    expect(signer.verify("lixo")).toBeNull();
  });
});
