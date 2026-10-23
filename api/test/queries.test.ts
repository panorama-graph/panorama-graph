import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { QUERY_CONTRACT_VERSION } from "../src/query/contract";
import { K, loadAcme } from "./fixtures/acme";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

const db = createTestDb();
const ORIGIN = "http://localhost:5173";
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger, corsOrigins: [ORIGIN] });
  await resetDatabase(db);
  await loadAcme(async (method, url, payload) => {
    const res = await app.inject({ method, url, payload: payload as Record<string, unknown> });
    return { statusCode: res.statusCode, body: res.body };
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const query = (tool: string, payload?: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: `/v1/queries/${tool}`, payload, headers });

const mcpCall = async (name: string, args: Record<string, unknown>) => {
  const res = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  return JSON.parse(res.json<{ result: { content: { text: string }[] } }>().result.content[0].text);
};

describe("Consultas por REST", () => {
  test("a mesma consulta devolve o mesmo que a ferramenta MCP", async () => {
    const args = { component: K.pca, direction: "in", depth: 2, kind: "frontend" };
    const res = await query("component_dependencies", args);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(await mcpCall("component_dependencies", args));
    expect(res.json().components[0].key).toBe(K.web);
  });

  test("corpo vazio usa os padrões, e detail segue o padrão da ferramenta", async () => {
    const overview = await query("architecture_overview");
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toEqual(await mcpCall("architecture_overview", {}));

    const brief = await query("components_list", {});
    expect(brief.json().components[0].facts[0]).not.toHaveProperty("observedAt");
    const full = await query("components_list", { detail: "full" });
    expect(full.json().components[0].facts[0]).toHaveProperty("observedAt");
  });

  test("erro de domínio volta com o status HTTP", async () => {
    const missing = await query("component_get", { component: "component:nao-existe" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toContain("não encontrado");
    expect(missing.json()).toMatchObject({ code: "not_found", status: 404 });

    const write = await query("graph_query", { cypher: "CREATE (n) RETURN n" });
    expect(write.statusCode).toBe(422);
    expect(write.json().error).toContain("só aceita leitura");
  });

  test("as consultas do console respondem igual pelas duas portas", async () => {
    for (const [tool, args] of [
      ["nodes_find", { text: "catalog" }],
      ["node_get", { node: K.sysCatalog }],
      ["sources_status", {}],
      ["fact_divergences", { node: K.pca }],
    ] as const) {
      const res = await query(tool, args, { origin: ORIGIN });
      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(res.json()).toEqual(await mcpCall(tool, args));
    }
  });

  test("argumento inválido, a mais ou ferramenta desconhecida é recusado", async () => {
    expect((await query("component_dependencies", { component: K.pca, depth: 9 })).statusCode).toBe(400);
    expect((await query("component_get", { component: K.pca, extra: true })).statusCode).toBe(400);
    const unknown = await query("nao_existe", {});
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<object>()).toEqual({
      error: `A ferramenta nao_existe não existe na versão ${QUERY_CONTRACT_VERSION} do contrato das consultas`,
      code: "unknown_tool",
      status: 404,
      details: { contractVersion: QUERY_CONTRACT_VERSION },
    });
  });

  test("GET /queries publica o contrato, e toda resposta diz a versão dele", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/queries" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ version: number; policy: string[]; tools: { name: string; stability: string; args: object }[] }>();
    expect(body.version).toBe(QUERY_CONTRACT_VERSION);
    expect(body.policy.length).toBeGreaterThan(0);
    expect(body.tools.find((t) => t.name === "graph_query")?.stability).toBe("exploratory");
    expect(body.tools.find((t) => t.name === "people_list")?.args).toHaveProperty("group");

    const q = await query("component_get", { component: K.pca });
    expect(q.headers["query-contract-version"]).toBe(String(QUERY_CONTRACT_VERSION));
    expect(q.headers.deprecation).toBeUndefined();
    const schema = await app.inject({ method: "GET", url: "/v1/schema" });
    expect(schema.json<{ queryContractVersion: number }>().queryContractVersion).toBe(QUERY_CONTRACT_VERSION);
  });

  test("CORS só para as origens configuradas", async () => {
    const ok = await query("component_get", { component: K.pca }, { origin: ORIGIN });
    expect(ok.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(ok.headers["access-control-expose-headers"]).toContain("query-contract-version");
    const other = await query("component_get", { component: K.pca }, { origin: "http://outra.exemplo" });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/v1/queries/component_get",
      headers: { origin: ORIGIN, "access-control-request-method": "POST" },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toBe("POST");
    const refused = await app.inject({
      method: "OPTIONS",
      url: "/v1/queries/component_get",
      headers: { origin: "http://outra.exemplo", "access-control-request-method": "POST" },
    });
    expect(refused.statusCode).toBe(403);
  });

  test("ingestão e MCP continuam sem CORS", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/schema", headers: { origin: ORIGIN } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
