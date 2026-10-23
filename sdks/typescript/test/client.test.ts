import { describe, expect, test } from "vitest";
import { PanoramaGraphClient, PanoramaGraphError, MODEL_VERSION } from "../src";

type Call = { url: string; method: string; body?: unknown };

/** Fetch que devolve as respostas na ordem e guarda as chamadas. */
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(init.body as string) } : {}) });
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, impl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("cliente REST", () => {
  test("consulta em /v1/queries/<nome>, com os argumentos no corpo", async () => {
    const f = fakeFetch(json({ target: "api:x/http", apis: [], consumers: [] }), json({ count: 0, truncated: false, nodes: [] }));
    const client = new PanoramaGraphClient({ baseUrl: "http://grafo:3200/", fetch: f.impl, headers: { "x-quem": "teste" } });
    const res = await client.query("api_consumers", { target: "x", endpoint: "GET /a" });
    expect(res.consumers).toEqual([]);
    await client.query("nodes_find");
    expect(f.calls).toEqual([
      { url: "http://grafo:3200/v1/queries/api_consumers", method: "POST", body: { target: "x", endpoint: "GET /a" } },
      { url: "http://grafo:3200/v1/queries/nodes_find", method: "POST", body: {} },
    ]);
  });

  test("erro da API vira PanoramaGraphError com o código", async () => {
    const f = fakeFetch(
      json({ error: "Retrato mais antigo", code: "outdated_snapshot", status: 409, details: { last: "x" } }, 409),
      new Response("bad gateway", { status: 502 }),
      new TypeError("connection refused"),
    );
    const client = new PanoramaGraphClient({ baseUrl: "http://grafo:3200", fetch: f.impl });
    const snapshot = { source: "teste", observedAt: "2026-01-01T00:00:00Z", nodes: [], relations: [] };
    const outdated = await client.ingest(snapshot).catch((e) => e);
    expect(outdated).toBeInstanceOf(PanoramaGraphError);
    expect(outdated).toMatchObject({ code: "outdated_snapshot", status: 409, message: "Retrato mais antigo", details: { last: "x" } });
    expect(await client.schema().catch((e) => e)).toMatchObject({ code: "internal", status: 502 });
    expect(await client.queryContract().catch((e) => e)).toMatchObject({ code: "unreachable", status: 0 });
  });

  test("ingest com dryRun pede a conferência sem gravar", async () => {
    const f = fakeFetch(json({ dryRun: true }), json({}));
    const client = new PanoramaGraphClient({ baseUrl: "http://grafo:3200", fetch: f.impl });
    const snapshot = { source: "teste", observedAt: "2026-01-01T00:00:00Z", nodes: [], relations: [] };
    await client.ingest(snapshot, { dryRun: true });
    await client.ingest(snapshot);
    expect(f.calls.map((c) => c.url)).toEqual(["http://grafo:3200/v1/ingest?dryRun=true", "http://grafo:3200/v1/ingest"]);
  });

  test("assertModel recusa API em outro modelo", async () => {
    const f = fakeFetch(json({ modelVersion: MODEL_VERSION }), json({ modelVersion: MODEL_VERSION + 1 }));
    const client = new PanoramaGraphClient({ baseUrl: "http://grafo:3200", fetch: f.impl });
    await client.assertModel();
    expect(await client.assertModel().catch((e) => e)).toMatchObject({ code: "conflict", details: { sdkModelVersion: MODEL_VERSION } });
  });

  test("token e credenciais: Authorization Bearer e o cookie da sessão; URLs de login e logout", async () => {
    const inits: RequestInit[] = [];
    const client = new PanoramaGraphClient({
      baseUrl: "http://grafo:3200",
      token: "abc",
      credentials: "include",
      fetch: async (_url, init) => {
        inits.push(init!);
        return json({ mode: "sso", identity: null });
      },
    });
    expect(await client.me()).toEqual({ mode: "sso", identity: null });
    expect(inits[0]).toMatchObject({ method: "GET", credentials: "include", headers: { authorization: "Bearer abc" } });
    expect(client.loginUrl("http://console/x?y=1")).toBe("http://grafo:3200/v1/auth/login?returnTo=http%3A%2F%2Fconsole%2Fx%3Fy%3D1");
    expect(client.logoutUrl("http://console/")).toBe("http://grafo:3200/v1/auth/logout?returnTo=http%3A%2F%2Fconsole%2F");
  });
});
