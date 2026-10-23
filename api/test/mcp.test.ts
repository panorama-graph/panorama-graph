import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { QUERY_CONTRACT_VERSION } from "../src/query/contract";
import { K, loadAcme } from "./fixtures/acme";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

const db = createTestDb();
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger });
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

let id = 0;
const rpc = (method: string, params: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/mcp",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
    payload: { jsonrpc: "2.0", id: ++id, method, params },
  });

const call = async (name: string, args: Record<string, unknown>) => {
  const res = await rpc("tools/call", { name, arguments: args });
  expect(res.statusCode).toBe(200);
  const { result } = res.json<{ result: { isError?: boolean; content: { type: string; text: string }[] } }>();
  return { isError: !!result.isError, body: JSON.parse(result.content[0].text) };
};

describe("MCP por Streamable HTTP", () => {
  test("initialize anuncia ferramentas e instruções", async () => {
    const res = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "teste", version: "0" },
    });
    expect(res.statusCode).toBe(200);
    const { result } = res.json<{ result: { serverInfo: { name: string }; capabilities: object; instructions: string } }>();
    expect(result.serverInfo.name).toBe("panorama-graph");
    expect(result.capabilities).toHaveProperty("tools");
    expect(result.instructions).toContain("source");
  });

  test("tools/list traz as dezoito ferramentas, todas só de leitura", async () => {
    const res = await rpc("tools/list");
    const { tools } = res.json<{ result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } }>().result;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "api_consumers",
      "architecture_overview",
      "component_compare",
      "component_dependencies",
      "component_get",
      "component_libraries",
      "components_list",
      "contract_get",
      "dataset_get",
      "fact_divergences",
      "graph_query",
      "library_usage",
      "node_get",
      "nodes_find",
      "org_structure",
      "people_list",
      "route_get",
      "sources_status",
      "topic_get",
    ]);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  test("tools/list traz a versão do contrato das consultas em cada ferramenta", async () => {
    type Meta = { version: number; since: number; stability: string };
    const res = await rpc("tools/list");
    const { tools } = res.json<{ result: { tools: { name: string; _meta: Record<string, Meta> }[] } }>().result;
    const meta = new Map(tools.map((t) => [t.name, t._meta["panorama-graph/contract"]]));
    expect(meta.get("people_list")).toEqual({ version: QUERY_CONTRACT_VERSION, since: 1, stability: "stable" });
    expect(meta.get("graph_query")?.stability).toBe("exploratory");
    expect([...meta.values()].every((m) => m.version === QUERY_CONTRACT_VERSION)).toBe(true);
  });

  test("tools/call devolve os fatos com a proveniência", async () => {
    const { isError, body } = await call("api_consumers", { target: "product-catalog-api" });
    expect(isError).toBe(false);
    expect(body.consumers[0].component.key).toBe(K.lsa);
    const fact = body.consumers[0].consumes[0].facts[0];
    expect(Object.keys(fact)).toEqual(expect.arrayContaining(["source", "state", "evidence", "observedAt"]));
  });

  test("contract_get devolve o contrato do endpoint com a evidência", async () => {
    const { isError, body } = await call("contract_get", { target: "product-catalog-api", endpoint: "POST /products" });
    expect(isError).toBe(false);
    expect(body.contract.components.schemas.CreateProductRequest.required).toEqual(["name"]);
    expect(body.apis[0].facts[0].evidence).toMatch(/#\/paths\/~1products\/post$/);
  });

  test("detail: summary resume as afirmações; full traz todas as propriedades", async () => {
    const overview = await call("architecture_overview", {});
    const dep = overview.body.dependencies.find((d: { from: string }) => d.from === K.lsa);
    const fact = dep.via[0].facts.dependent[0];
    expect(Object.keys(fact).sort()).toEqual(expect.arrayContaining(["evidence", "source"]));
    expect(fact).not.toHaveProperty("observedAt");

    const full = await call("components_list", { detail: "full" });
    expect(full.body.components[0].facts[0]).toHaveProperty("observedAt");
    const brief = await call("components_list", {});
    expect(brief.body.components[0].facts[0]).not.toHaveProperty("observedAt");
    expect(JSON.stringify(brief.body).length).toBeLessThan(JSON.stringify(full.body).length);
  });

  test("component_dependencies com kind devolve os caminhos; architecture_overview aceita component", async () => {
    const deps = await call("component_dependencies", { component: K.pca, direction: "in", depth: 2, kind: "frontend" });
    expect(deps.body.components.map((c: { key: string }) => c.key)).toEqual([K.web]);
    expect(deps.body.components[0].paths[0]).toHaveLength(2);
    const around = await call("architecture_overview", { component: "product-catalog-api" });
    expect(around.body.center).toBe(K.pca);
  });

  test("erro de domínio volta como isError com os detalhes", async () => {
    const amb = await call("component_get", { component: "component:nao-existe" });
    expect(amb.isError).toBe(true);
    expect(amb.body.error).toContain("não encontrado");
    expect(amb.body).toMatchObject({ code: "not_found", status: 404 });

    const write = await call("graph_query", { cypher: "CREATE (n) RETURN n" });
    expect(write.isError).toBe(true);
    expect(write.body.error).toContain("só aceita leitura");

    const read = await call("graph_query", { cypher: "MATCH (c:Component) RETURN count(c) AS n" });
    expect(read.body.rows).toEqual([{ n: 4 }]);
  });

  test("argumento inválido é recusado pelo esquema", async () => {
    const res = await rpc("tools/call", { name: "component_dependencies", arguments: { component: K.pca, depth: 9 } });
    const body = res.json<{ result?: { isError: boolean }; error?: unknown }>();
    expect(body.error ?? body.result?.isError).toBeTruthy();
  });

  test("GET e DELETE não se aplicam sem sessão", async () => {
    expect((await app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(405);
    expect((await app.inject({ method: "DELETE", url: "/mcp" })).statusCode).toBe(405);
  });
});
