import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { ApiError } from "../src/errors";
import { RetentionService } from "../src/ingest/RetentionService";
import { QueryService } from "../src/query/QueryService";
import { K, loadAcme, type Load } from "./fixtures/acme";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

const db = createTestDb();
const q = new QueryService(db);
let app: FastifyInstance;

const PRD = "env:prd";
const OLD = "9a8b7c6";
const epDelete = "endpoint:product-catalog-api/DELETE /products/{id}";
const deleteContract = { format: "openapi-3.0", responses: { "204": { description: "Removido" } } };

/** Produção roda a 1.0.0, mais antiga que a linha principal (1.1.0). */
const prdDeployment = (commit: string, version: string): Load => ({
  source: "k8s-deployments",
  scope: { cluster: "acme", namespace: "prd" },
  evidenceBase: "k8s://acme/prd/",
  nodes: [{ key: PRD, type: "Environment", props: { name: "prd", kind: "production" }, evidence: "namespace/prd" }],
  relations: [{ type: "DEPLOYED_IN", from: K.pca, to: PRD, props: { version, commit }, evidence: "deployment/product-catalog-api" }],
});

/**
 * Retrato congelado da 1.0.0: tinha o DELETE (que a linha principal removeu), ainda não tinha o POST, e o GET de um
 * produto com outra descrição. Bibliotecas e stack mais antigas.
 */
const frozenOpenapi: Load = {
  source: "openapi",
  scope: { component: "product-catalog-api", commit: OLD },
  revision: { component: K.pca, commit: OLD, version: "1.0.0" },
  evidenceBase: `product-catalog-api@${OLD}:build/architecture/openapi.json`,
  nodes: [
    { key: K.pcaApi, type: "Api", props: { kind: "http" } },
    { key: K.epGetOne, type: "Endpoint", props: { method: "GET", path: "/products/{id}", description: "Produto (1.0)" }, evidence: "#/paths/~1products~1{id}/get" },
    { key: K.epList, type: "Endpoint", props: { method: "GET", path: "/products" }, evidence: "#/paths/~1products/get" },
    {
      key: epDelete,
      type: "Endpoint",
      props: { method: "DELETE", path: "/products/{id}", contract: JSON.stringify(deleteContract) },
      evidence: "#/paths/~1products~1{id}/delete",
    },
  ],
  relations: [
    { type: "PROVIDES", from: K.pca, to: K.pcaApi },
    { type: "HAS_ENDPOINT", from: K.pcaApi, to: K.epGetOne, evidence: "#/paths/~1products~1{id}/get" },
    { type: "HAS_ENDPOINT", from: K.pcaApi, to: K.epList, evidence: "#/paths/~1products/get" },
    { type: "HAS_ENDPOINT", from: K.pcaApi, to: epDelete, evidence: "#/paths/~1products~1{id}/delete" },
  ],
};

const frozenSbom: Load = {
  source: "sbom",
  scope: { component: "product-catalog-api", commit: OLD },
  revision: { component: K.pca, commit: OLD, version: "1.0.0" },
  evidenceBase: `product-catalog-api@${OLD}:target/bom.json#`,
  relations: [
    { type: "BUILT_WITH", from: K.pca, to: K.springBoot, props: { version: "3.1.0" } },
    { type: "BUILT_WITH", from: K.pca, to: K.java, props: { version: "21" } },
    { type: "DEPENDS_ON", from: K.pca, to: K.platform, props: { version: "2.0.0", scope: "compile", resolved: true, direct: true } },
  ],
};

const start = Date.UTC(2026, 8, 29, 9, 0, 0);
let clock = Date.UTC(2026, 9, 1, 9, 0, 0);
async function ingest(load: Load, observedAt = new Date((clock += 1000)).toISOString()) {
  const res = await app.inject({ method: "POST", url: "/v1/ingest", payload: { ...load, observedAt } });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger });
  await resetDatabase(db);
  await loadAcme(async (method, url, payload) => {
    const res = await app.inject({ method, url, payload: payload as Record<string, unknown> });
    return { statusCode: res.statusCode, body: res.body };
  }, start);
  for (const load of [frozenOpenapi, frozenSbom, prdDeployment(OLD, "1.0.0")]) {
    const res = await ingest(load);
    if (res.statusCode >= 300) throw new Error(`carga falhou: ${JSON.stringify(res.body)}`);
  }
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const keys = (xs: { node: { key: string } }[]) => xs.map((x) => x.node.key).sort();

async function rejects(p: Promise<unknown>, status: number): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(status);
    return err as ApiError;
  }
  throw new Error("esperava erro");
}

describe("retrato congelado na ingestão", () => {
  test("escopo com commit exige a revisão, e o commit dos dois tem de ser o mesmo", async () => {
    const { revision: _, ...semRevisao } = frozenOpenapi;
    const a = await ingest(semRevisao);
    expect(a.statusCode).toBe(422);
    expect(JSON.stringify(a.body)).toContain("retrato congelado: informe revision");
    const b = await ingest({ ...frozenOpenapi, revision: { component: K.pca, commit: "outro" } });
    expect(b.statusCode).toBe(422);
    expect(JSON.stringify(b.body)).toContain("precisam ser o mesmo commit");
    const c = await ingest({ ...frozenOpenapi, revision: { component: K.pcaApi, commit: OLD } });
    expect(c.statusCode).toBe(422);
    expect(JSON.stringify(c.body)).toContain("e não de Component");
  });

  test("não muda as propriedades do nó nem a vigência na linha principal", async () => {
    const line = await q.contractGet(K.pca);
    if (!("apis" in line) || "endpoint" in line) throw new Error("esperava a lista");
    const endpoints = line.apis[0].endpoints.map((e) => e.node.key).sort();
    expect(endpoints).toEqual([K.epList, K.epCreate, K.epGetOne].sort());
    expect(line.apis[0].endpoints.find((e) => e.node.key === K.epGetOne)).not.toHaveProperty("description");

    const node = await q.nodeGet(epDelete);
    expect(node.node.status).toBe("stale");
    expect(node.node.facts).toEqual([]);
    expect(node.relations).toEqual([]);
    await rejects(q.contractGet(K.pca, { endpoint: "DELETE /products/{id}" }), 404);
  });

  test("sources_status diz de que versão é cada escopo", async () => {
    const status = await q.sourcesStatus({ source: "openapi" });
    const scopes = status.sources[0].scopes.filter((s) => s.scope.component === "product-catalog-api");
    expect(scopes.map((s) => s.revision)).toEqual(
      expect.arrayContaining([
        { component: K.pca, commit: "a1b2c3d", version: "1.1.0", frozen: false },
        { component: K.pca, commit: OLD, version: "1.0.0", frozen: true },
      ]),
    );
  });

  test("a divergência entre fontes não confunde versões diferentes com fontes que discordam", async () => {
    const res = await q.factDivergences({ node: K.pca });
    const scopes = res.divergences.flatMap((d) => d.edges.flatMap((e) => e.facts.map((f) => f.scope)));
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.filter((s) => "commit" in s)).toEqual([]);
  });
});

describe("recorte por ambiente", () => {
  test("sem ambiente, a linha principal; com env:prd, a versão implantada lá", async () => {
    const line = await q.componentGet(K.pca);
    expect(line).not.toHaveProperty("environment");
    expect(line.component).not.toHaveProperty("version");
    expect(line.revision).toMatchObject({ commit: "a1b2c3d", version: "1.1.0" });
    expect(keys(line.provides[0].endpoints)).toEqual([K.epList, K.epCreate, K.epGetOne].sort());
    expect(line.stack.find((e) => e.node.key === K.springBoot)!.facts.map((f) => f.props?.version)).toEqual(["3.2.4"]);

    const prd = await q.componentGet(K.pca, { environment: "prd" });
    expect(prd.environment).toBe(PRD);
    expect(prd.component).toMatchObject({ version: "1.0.0" });
    expect(keys(prd.provides[0].endpoints)).toEqual([K.epList, epDelete, K.epGetOne].sort());
    expect(prd.stack.find((e) => e.node.key === K.springBoot)!.facts.map((f) => f.props?.version)).toEqual(["3.1.0"]);
    // O que não tem retrato congelado (organização, recursos, datasets) segue a linha principal.
    expect(prd.owners).toEqual(line.owners);
    expect(prd.data).toEqual(line.data);
  });

  test("deployments: onde roda, em ordem até a produção, com a versão, o retrato e a comparação com a linha principal", async () => {
    const res = await q.componentGet(K.pca);
    expect(res.deployments.map((d) => [d.environment.key, d.version, d.commit, d.frozen, d.sameAsDefault, d.status])).toEqual([
      [K.dev, "1.1.0", "a1b2c3d", false, true, "current"],
      [PRD, "1.0.0", OLD, true, false, "current"],
    ]);
    expect(res.deployments[0]).toMatchObject({ image: "registry/product-catalog-api:1.1.0", replicas: "2" });
    expect(res.deployments[0].facts.map((f) => f.source)).toEqual(["k8s-deployments"]);
    expect(res).not.toHaveProperty("coverage.deployments");

    const job = await q.componentGet(K.job);
    expect(job.deployments).toEqual([]);
    expect(job.coverage?.deployments?.sources.map((s) => s.source)).toEqual(["k8s-deployments"]);
  });

  test("o contrato do endpoint é o da versão do ambiente, e o endpoint que só existe lá só se acha lá", async () => {
    const prd = await q.contractGet(K.pca, { environment: PRD, endpoint: "DELETE /products/{id}" });
    if (!("endpoint" in prd)) throw new Error("esperava o endpoint");
    expect(prd.environment).toBe(PRD);
    expect(prd).toMatchObject({ contract: deleteContract });

    const list = await q.contractGet(K.pca, { environment: PRD });
    if (!("apis" in list) || "endpoint" in list) throw new Error("esperava a lista");
    const getOne = list.apis[0].endpoints.find((e) => e.node.key === K.epGetOne)!;
    expect(getOne).toMatchObject({ description: "Produto (1.0)" });
    expect(list.apis[0].endpoints.find((e) => e.node.key === epDelete)).toMatchObject({ hasContract: true });
  });

  test("a versão vem na ponta de cada componente implantado no ambiente", async () => {
    const dev = await q.apiConsumers(K.pca, { environment: "dev" });
    expect(dev.environment).toBe(K.dev);
    expect(dev.consumers[0].component).toMatchObject({ key: K.lsa, version: "2.0.0" });

    const prd = await q.apiConsumers(K.pca, { environment: PRD });
    // A loan-simulation-api não está implantada em prd: aparece pela linha principal, sem versão.
    expect(prd.consumers[0].component.key).toBe(K.lsa);
    expect(prd.consumers[0].component).not.toHaveProperty("version");

    const overview = await q.architectureOverview({ environment: PRD });
    const pca = overview.components.find((c) => c.key === K.pca)!;
    expect(pca.version).toBe("1.0.0");
    expect(pca.provides[0].endpoints).toBe(3);

    const deps = await q.componentDependencies(K.pca, { direction: "in", environment: "dev" });
    expect(deps.components.find((c) => c.key === K.pca)).toMatchObject({ version: "1.1.0" });
  });

  test("ambiente sem retrato congelado: a versão aparece, e o resto é a linha principal", async () => {
    const dev = await q.componentGet(K.pca, { environment: "dev" });
    expect(dev.component).toMatchObject({ version: "1.1.0" });
    expect(keys(dev.provides[0].endpoints)).toEqual([K.epList, K.epCreate, K.epGetOne].sort());
  });

  test("ambiente desconhecido é 404", async () => {
    await rejects(q.componentGet(K.pca, { environment: "env:nenhum" }), 404);
  });
});

describe("component_compare", () => {
  test("o que está em prd e já saiu do código, e o que entrou depois", async () => {
    const res = await q.componentCompare(K.pca, { from: PRD });
    expect(res.from).toMatchObject({ environment: PRD, version: "1.0.0", commit: OLD, frozen: true });
    expect(res.to).toEqual({ line: true, version: "1.1.0", commit: "a1b2c3d" });
    expect(res.same).toBe(false);
    expect(res.changes.endpoints!.added.map((n) => n.key)).toEqual([K.epCreate]);
    expect(res.changes.endpoints!.removed.map((n) => n.key)).toEqual([epDelete]);
    expect(res.changes.libraries!.changed).toEqual([{ node: expect.objectContaining({ key: K.platform }), from: "2.0.0", to: "2.3.1" }]);
    expect(res.changes.stack!.changed).toEqual([{ node: expect.objectContaining({ key: K.springBoot }), from: "3.1.0", to: "3.2.4" }]);
    expect(res.changes).not.toHaveProperty("owns");
  });

  test("lado sem o retrato da versão implantada avisa que é a linha principal", async () => {
    const res = await q.componentCompare(K.pca, { from: "dev" });
    expect(res.from).toMatchObject({ environment: K.dev, version: "1.1.0", frozen: false });
    expect(res.from).toMatchObject({ note: expect.stringContaining("não tem o retrato da versão implantada") });
    expect(res.same).toBe(true);
    expect(res.changes).toEqual({});
  });

  test("os dois lados iguais é erro", async () => {
    await rejects(q.componentCompare(K.pca, {}), 422);
    await rejects(q.componentCompare(K.pca, { from: PRD, to: PRD }), 422);
  });
});

describe("histórico e retenção", () => {
  const retention = new RetentionService(db);
  const far = new Date(Date.UTC(2028, 0, 1));

  test("enquanto o commit está implantado, o retrato congelado fica", async () => {
    const r = await retention.prune(far);
    expect(r.frozenScopes).toEqual([]);
    const prd = await q.componentGet(K.pca, { environment: PRD });
    expect(keys(prd.provides[0].endpoints)).toContain(epDelete);
  });

  test("a promoção troca a implantação, e a anterior vira histórico (includeStale)", async () => {
    const res = await ingest(prdDeployment("a1b2c3d", "1.1.0"));
    expect(res.statusCode).toBe(200);
    const now = await q.componentGet(K.pca);
    expect(now.deployments.filter((d) => d.environment.key === PRD).map((d) => d.version)).toEqual(["1.1.0"]);
    const history = await q.componentGet(K.pca, { includeStale: true });
    expect(history.deployments.filter((d) => d.environment.key === PRD).map((d) => [d.version, d.status])).toEqual(
      expect.arrayContaining([
        ["1.1.0", "current"],
        ["1.0.0", "stale"],
      ]),
    );
    const prd = await q.componentGet(K.pca, { environment: PRD });
    expect(keys(prd.provides[0].endpoints)).toEqual([K.epList, K.epCreate, K.epGetOne].sort());
  });

  test("fora de todos os ambientes, o retrato congelado e o histórico vencido somem; a linha principal fica", async () => {
    const before = await q.componentGet(K.pca);
    const r = await retention.prune(far);
    expect(r.frozenScopes.map((s) => s.scope).sort((a, b) => a.component.localeCompare(b.component))).toEqual([
      { component: "product-catalog-api", commit: OLD },
      { component: "product-catalog-api", commit: OLD },
    ]);
    expect(r.deployments).toBe(1);
    expect(r.nodes).toBe(1);
    await rejects(q.nodeGet(epDelete), 404);
    const after = await q.componentGet(K.pca, { includeStale: true });
    expect(after.deployments.map((d) => d.version)).toEqual(["1.1.0", "1.1.0"]);
    expect(keys(after.provides[0].endpoints)).toEqual(keys(before.provides[0].endpoints));
    const status = await q.sourcesStatus({ source: "sbom" });
    expect(status.sources[0].scopes.some((s) => s.revision?.frozen)).toBe(false);
  });
});
