import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Ajv, { type ValidateFunction } from "ajv";
import type { FastifyInstance } from "fastify";
import { currentContract } from "../scripts/contract";
import { currentOpenApi } from "../scripts/openapi";
import { buildApp } from "../src/app";
import { resultName } from "../src/query/contract";
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

/**
 * Cada resposta, nas duas formas das afirmações e nos recortes de cada ferramenta, contra o esquema publicado no
 * contrato. O esquema não aceita campo a mais: uma resposta com campo que o contrato não descreve falha aqui.
 */
const CASES: Record<string, Record<string, unknown>[]> = {
  architecture_overview: [{}, { detail: "full" }, { domain: K.domain }, { team: K.dept }, { component: K.pca, depth: 2, includeStale: true }],
  component_get: [
    { component: K.pca },
    { component: K.lsa, detail: "summary" },
    { component: K.web, includeStale: true },
    { component: K.pca, environment: "dev" },
  ],
  component_compare: [{ component: K.pca, from: "dev" }],
  components_list: [{}, { domain: K.domain, team: K.dept, technology: "spring-boot", detail: "full" }, { kind: "frontend" }],
  api_consumers: [
    { target: K.pca },
    { target: K.pcaApi, endpoint: "GET /products/{id}", detail: "summary" },
    { target: K.pca, environment: "dev" },
  ],
  contract_get: [{ target: K.pca }, { target: K.pca, endpoint: "GET /products/{id}", detail: "full" }, { target: K.pca, endpoint: "POST /products" }],
  component_dependencies: [
    { component: K.pca, direction: "in", depth: 3 },
    { component: K.pca, direction: "in", depth: 3, kind: "frontend", detail: "summary" },
    { component: K.lsa, direction: "both", kind: "job" },
  ],
  topic_get: [{ topic: K.topic }, { topic: K.topic, detail: "summary", includeStale: true }],
  dataset_get: [{ dataset: K.products }, { dataset: K.sequences, detail: "summary" }],
  org_structure: [{}, { group: K.dept, depth: 0 }, { depth: 5, detail: "summary" }],
  people_list: [{}, { group: K.teamCatalog, detail: "summary" }, { text: "ninguém" }],
  library_usage: [{ library: K.platform }, { library: K.platform, versionRange: "<99", detail: "summary" }, { library: "mongodb-driver-sync", direct: false }],
  component_libraries: [{ component: K.pca }, { component: K.pca, transitive: true, detail: "full" }, { component: K.lsa, unused: true }],
  route_get: [{ host: "api.dev.acmebank.example" }, { host: "api.dev.acmebank.example", path: "/catalog/simulation/x", detail: "summary" }],
  nodes_find: [{ text: "product" }, { types: ["Library"], referencedOnly: true }, { text: "product-catalog", includeStale: true }],
  node_get: [{ node: K.sysCatalog }, { node: K.ingress, detail: "summary" }, { node: K.pcaOld, includeStale: true }],
  sources_status: [{}, { source: "gitlab", limit: 2 }],
  fact_divergences: [{}, { detail: "summary" }, { relationType: "OWNED_BY" }],
  graph_query: [{ cypher: "MATCH (n:Node) RETURN n.key AS key LIMIT 3" }],
};

describe("Respostas das consultas conforme o contrato", () => {
  const contract = currentContract();
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema({ $id: "contract", definitions: contract.definitions });
  const validators = new Map<string, ValidateFunction>(
    contract.tools.map((t) => [t.name, ajv.compile({ $ref: `contract#/definitions/${resultName(t)}` })]),
  );

  test("toda ferramenta tem casos aqui", () => {
    expect(Object.keys(CASES).sort()).toEqual(contract.tools.map((t) => t.name).sort());
  });

  for (const [tool, cases] of Object.entries(CASES)) {
    test(tool, async () => {
      for (const args of cases) {
        const res = await app.inject({ method: "POST", url: `/v1/queries/${tool}`, payload: args });
        expect({ args, status: res.statusCode }).toEqual({ args, status: 200 });
        const validate = validators.get(tool)!;
        const ok = validate(res.json());
        expect({ args, errors: validate.errors ?? [] }).toEqual({ args, errors: [] });
        expect(ok).toBe(true);
      }
    });
  }
});

describe("Respostas das demais rotas conforme o OpenAPI", () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const check = async (schema: string, res: { statusCode: number; json: () => unknown }) => {
    if (!ajv.getSchema("openapi")) ajv.addSchema({ $id: "openapi", ...(await currentOpenApi()) });
    expect(res.statusCode).toBeLessThan(300);
    const validate = ajv.getSchema(`openapi#/components/schemas/${schema}`)!;
    const ok = validate(res.json());
    expect({ schema, errors: validate.errors ?? [] }).toEqual({ schema, errors: [] });
    expect(ok).toBe(true);
  };
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload });

  test("modelo, contrato das consultas, carga, apelido, união e aposentadoria", async () => {
    await check("ModelDescription", await app.inject({ method: "GET", url: "/v1/schema" }));
    await check("QueryContractDocument", await app.inject({ method: "GET", url: "/v1/queries" }));
    const at = "2027-01-01T00:00:00.000Z";
    const snapshot = {
      source: "teste",
      scope: { component: "teste/a" },
      observedAt: at,
      nodes: [
        { key: "component:teste/a", type: "Component", props: { name: "a" }, evidence: "x" },
        { key: "component:teste/b", type: "Component", evidence: "x" },
      ],
      relations: [{ type: "OWNED_BY", from: "component:teste/a", to: K.teamCatalog, evidence: "x" }],
    };
    await check("IngestResult", await post("/v1/ingest", snapshot));
    await check("AliasResult", await post(`/v1/nodes/${encodeURIComponent("component:teste/a")}/aliases`, { alias: "component:teste/apelido" }));
    await check("MergeResult", await post("/v1/nodes/merge", { from: "component:teste/b", into: "component:teste/a", reason: "teste", actor: "teste" }));
    await check(
      "RetireResult",
      await post("/v1/scopes/retire", { scope: { component: "teste/a" }, observedAt: "2027-01-02T00:00:00.000Z", retiredBy: "teste", reason: "teste", evidence: "x" }),
    );
  });
});

