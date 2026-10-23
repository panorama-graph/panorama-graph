import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../errors";
import type { AuthConfig } from "./config";
import { ANONYMOUS, INGEST_TOKEN_IDENTITY, type Identity } from "./identity";
import { JwtVerifier } from "./jwt";
import { OidcLogin, type LoginTransaction } from "./oidc";
import { parseCookies, serializeCookie, Signer } from "./session";

/**
 * Acesso de cada rota (`config.access`): `public` (saúde, OpenAPI, login), `read` (consultas, modelo, MCP; o padrão)
 * ou `write` (ingestão e identidade dos nós). `config.cors` libera a rota para as origens de `CORS_ORIGINS`, com
 * credenciais (o cookie da sessão do console).
 */
export type Access = "public" | "read" | "write";

declare module "fastify" {
  interface FastifyContextConfig {
    access?: Access;
    cors?: boolean;
  }
  interface FastifyRequest {
    identity: Identity | null;
  }
}

export const SESSION_COOKIE = "pg_session";
export const LOGIN_COOKIE = "pg_login";
const LOGIN_TTL_SECONDS = 600;
/** Acima disso o navegador pode descartar o cookie (o limite é 4096 com nome e atributos). */
const MAX_COOKIE_VALUE = 3800;

/**
 * A autenticação da instância. Sem SSO, toda requisição é da identidade anônima; o token de ingestão, se houver,
 * passa a ser exigido na escrita. Com SSO, a pessoa entra pelo provedor e ganha uma sessão em cookie assinado, e as
 * máquinas mandam um token. Em qualquer modo, `Authorization: Bearer` aceita o token de ingestão e os JWTs dos
 * emissores confiáveis.
 */
export class Auth {
  readonly mode: "anonymous" | "sso";
  readonly login?: OidcLogin;
  private readonly signer?: Signer;
  private readonly jwt?: JwtVerifier;
  /** Para onde o login e o logout podem voltar: as origens do CORS e a própria API. */
  private readonly returnOrigins: Set<string>;

  constructor(
    readonly config: AuthConfig,
    readonly corsOrigins: string[] = [],
  ) {
    this.mode = config.sso ? "sso" : "anonymous";
    if (config.sso) {
      this.login = new OidcLogin(config.sso);
      this.signer = new Signer(config.sso.sessionSecret);
    }
    if (config.jwt) this.jwt = new JwtVerifier(config.jwt);
    this.returnOrigins = new Set([...corsOrigins, ...(config.sso ? [new URL(config.sso.publicUrl).origin] : [])]);
  }

  async identify(req: FastifyRequest): Promise<Identity | null> {
    const header = req.headers.authorization;
    if (header) {
      const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];
      if (!token) throw unauthorized("O cabeçalho Authorization deve ser Bearer <token>");
      if (this.config.ingestToken && sameText(token, this.config.ingestToken)) return INGEST_TOKEN_IDENTITY;
      const identity = await this.jwt?.verify(token);
      if (identity) return identity;
      throw unauthorized("Token inválido, vencido ou de um emissor que esta instância não aceita");
    }
    if (!this.signer) return ANONYMOUS;
    return this.signer.verify<{ identity: Identity }>(parseCookies(req.headers.cookie)[SESSION_COOKIE])?.identity ?? null;
  }

  authorize(access: Access, identity: Identity | null): void {
    if (access === "public") return;
    if (!identity) throw unauthorized("Entre pelo SSO ou envie um token (Authorization: Bearer)");
    if (access === "write" && identity.kind === "anonymous" && this.config.ingestToken) {
      throw unauthorized("A escrita exige o token de ingestão (Authorization: Bearer)");
    }
  }

  /** `returnTo` se ele for de uma origem conhecida; senão, o console (a primeira origem do CORS) ou a API. */
  returnTo(requested: string | undefined): string {
    if (requested) {
      try {
        if (this.returnOrigins.has(new URL(requested).origin)) return requested;
      } catch {
        // cai no padrão
      }
    }
    return this.corsOrigins[0] ?? this.config.sso?.publicUrl ?? "/";
  }

  startSession(reply: FastifyReply, identity: Identity): void {
    const value = this.signer!.sign({ identity }, this.config.sso!.sessionTtlSeconds);
    if (value.length > MAX_COOKIE_VALUE) {
      throw new ApiError(
        500,
        `A sessão não cabe num cookie: o provedor mandou ${identity.groups.length} grupos. Restrinja os grupos que o ` +
          "provedor envia ao aplicativo ou troque a claim em OIDC_GROUPS_CLAIM.",
      );
    }
    this.setCookie(reply, SESSION_COOKIE, value, this.config.sso!.sessionTtlSeconds);
  }

  endSession(reply: FastifyReply): void {
    this.setCookie(reply, SESSION_COOKIE, "", 0);
  }

  saveLogin(reply: FastifyReply, tx: LoginTransaction): void {
    this.setCookie(reply, LOGIN_COOKIE, this.signer!.sign(tx, LOGIN_TTL_SECONDS), LOGIN_TTL_SECONDS);
  }

  /** A transação do login em andamento (e a apaga): null se venceu ou foi iniciada em outro navegador. */
  takeLogin(req: FastifyRequest, reply: FastifyReply): LoginTransaction | null {
    this.setCookie(reply, LOGIN_COOKIE, "", 0);
    return this.signer!.verify<LoginTransaction>(parseCookies(req.headers.cookie)[LOGIN_COOKIE]);
  }

  private setCookie(reply: FastifyReply, name: string, value: string, maxAge: number): void {
    const sso = this.config.sso!;
    const cookie = serializeCookie(name, value, { maxAge, sameSite: sso.sameSite, secure: sso.publicUrl.startsWith("https:") || sso.sameSite === "none" });
    const current = reply.getHeader("set-cookie");
    reply.header("set-cookie", [...(Array.isArray(current) ? current : current ? [String(current)] : []), cookie]);
  }
}

/**
 * Instala a autenticação no app: CORS das rotas marcadas (antes do resto, para o navegador ler até o 401), a
 * identidade de cada requisição e o acesso exigido pela rota. Hooks na raiz valem para todas as rotas.
 */
export function installAuth(app: FastifyInstance, auth: Auth): void {
  const allowed = new Set(auth.corsOrigins);
  app.decorateRequest("identity", null);
  app.addHook("onRequest", async (req, reply) => {
    const config = req.routeOptions.config ?? {};
    if (config.cors) {
      const origin = req.headers.origin;
      reply.header("vary", "Origin");
      if (origin && allowed.has(origin)) {
        reply.header("access-control-allow-origin", origin);
        reply.header("access-control-allow-credentials", "true");
        reply.header("access-control-expose-headers", "query-contract-version, deprecation, link");
      }
    }
    if (req.method === "OPTIONS" || req.url.startsWith("/docs")) return;
    const access = config.access ?? "read";
    try {
      req.identity = await auth.identify(req);
      auth.authorize(access, req.identity);
    } catch (err) {
      if (access === "public") return; // rota pública com token ruim: segue sem identidade
      if (err instanceof ApiError && err.statusCode === 401) reply.header("www-authenticate", 'Bearer realm="panorama-graph"');
      throw err;
    }
  });
}

function unauthorized(message: string): ApiError {
  return new ApiError(401, message, undefined, "unauthorized");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
