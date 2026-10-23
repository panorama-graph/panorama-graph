import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { ApiError } from "../src/errors";
import { QueryService } from "../src/query/QueryService";
import { resolveRef } from "../src/query/resolveRef";
import { compareVersions, parseRange, satisfies } from "../src/query/versions";
import { createProductContract, K, loadAcme, openapi, sbom } from "./fixtures/acme";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

const db = createTestDb();
const q = new QueryService(db);
let app: FastifyInstance;

const post = async (method: "POST", url: string, payload: unknown) => {
  const res = await app.inject({ method, url, payload: payload as Record<string, unknown> });
  return { statusCode: res.statusCode, body: res.body };
};

// A fixture é carregada uma vez: estas consultas não escrevem. Os testes que escrevem ficam no fim, em ordem.
beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger });
  await resetDatabase(db);
  await loadAcme(post);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const keys = (xs: { key: string }[]) => xs.map((x) => x.key).sort();
const sources = (facts: { source: string }[]) => facts.map((f) => f.source).sort();

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

describe("perguntas de validação do ACME Bank", () => {
  test("1. quem chama a product-catalog-api: loan-simulation-api, pelo Pact e pelo Helm", async () => {
    const res = await q.apiConsumers("product-catalog-api");
    expect(res.apis).toEqual([K.pcaApi]);
    expect(res.consumers.map((c) => c.component.key)).toEqual([K.lsa]);
    const [consumes] = res.consumers[0].consumes;
    expect(sources(consumes.facts)).toEqual(["pact-broker", "service-config"]);
    const helm = consumes.facts.find((f) => f.source === "service-config")!;
    expect(helm).toMatchObject({
      state: "observed",
      status: "current",
      scope: { component: "loan-simulation-api" },
      evidence: "loan-simulation-api@d4e5f6a:helm/values-dev.yaml:22",
    });
    expect(helm.observedAt).toBeTypeOf("string");
  });

  test("2. de quais endpoints a loan-simulation-api depende: os das interações do pact", async () => {
    const res = await q.apiConsumers(K.pcaApi);
    const calls = res.consumers[0].calls;
    expect(calls.map((e) => e.node.key).sort()).toEqual([K.epList, K.epGetOne].sort());
    expect(calls.find((e) => e.node.key === K.epGetOne)!.facts[0].evidence).toMatch(/#interaction-1$/);

    const one = await q.apiConsumers(K.pca, { endpoint: "get /products/{id}" });
    expect(one.endpoint).toBe(K.epGetOne);
    expect(one.consumers[0].consumes).toEqual([]);
    expect(one.consumers[0].calls.map((e) => e.node.key)).toEqual([K.epGetOne]);

    const none = await q.apiConsumers(K.pca, { endpoint: "POST /products" });
    expect(none.consumers).toEqual([]);
  });

  test("3. quem publica e quem consome o evento", async () => {
    const res = await q.topicGet("credit.product-catalog.product-created");
    expect(res.publishers.map((e) => e.node.key)).toEqual([K.pca]); // publicado com o nome antigo
    expect(res.subscribers.map((e) => e.node.key)).toEqual([K.lsa]);
    expect(res.hostedOn[0].node.key).toBe(K.kafka);
    expect(res.publishers[0].facts[0].evidence).toBe("product-catalog-api@a1b2c3d:src/main/resources/application.yaml:30");
  });

  test("4. banco da product-catalog-api, motor e versão, apesar do nome antigo", async () => {
    const res = await q.componentGet("product-catalog");
    expect(res.component.key).toBe(K.pca);
    expect(res.component.aliases).toEqual([K.pcaOld]);
    const [db1] = res.resources;
    expect(db1.node).toMatchObject({ key: K.mongoDb, kind: "database" });
    expect(db1.facts[0].props).toEqual({ access: "read-write" });
    const [server] = db1.hostedOn;
    expect(server.node.key).toBe(K.mongo);
    expect(server.runs[0]).toMatchObject({ node: { key: K.mongodb } });
    expect(server.runs[0].facts[0]).toMatchObject({ source: "k8s-infra", props: { version: "7.0.5" } });
    // O ambiente é da instância; o banco lógico não o afirma direto.
    expect(db1.environments).toEqual([]);
    expect(server.environments.map((e) => e.node.key)).toEqual([K.dev]);
    expect(sources(server.environments[0].facts)).toEqual(["k8s-infra"]);
    // APIs oferecidas, com os endpoints de cada uma.
    const [api] = res.provides;
    expect(api.node.key).toBe(K.pcaApi);
    expect(api.endpoints.map((e) => e.node.key).sort()).toEqual([K.epList, K.epGetOne, K.epCreate].sort());
  });

  test("5. quem usa PostgreSQL, e o banco compartilhado", async () => {
    const res = await q.componentsList({ technology: "postgresql" });
    expect(keys(res.components)).toEqual([K.lsa, K.job].sort());
    const path = res.components.find((c) => c.key === K.job)!.matchedBy[0].path;
    expect(path.map((h) => `${h.type}>${h.node.key}`)).toEqual([
      `USES_RESOURCE>${K.pgDb}`,
      `HOSTED_ON>${K.pg}`,
      `RUNS>${K.postgresql}`,
    ]);
    // O mesmo banco lógico nos dois caminhos: compartilhado.
    const dbs = res.components.map((c) => c.matchedBy[0].path[0].node.key);
    expect(new Set(dbs)).toEqual(new Set([K.pgDb]));
  });

  test("6. componentes do domínio Crédito e o dono de cada um", async () => {
    const res = await q.componentsList({ domain: "Crédito" });
    expect(keys(res.components)).toEqual([K.lsa, K.web, K.job, K.pca].sort());
    const owner = Object.fromEntries(res.components.map((c) => [c.key, c.owners.map((o) => o.node.key)]));
    expect(owner[K.pca]).toEqual([K.teamCatalog]);
    expect(owner[K.lsa]).toEqual([K.teamSimulation]);
    const pca = res.components.find((c) => c.key === K.pca)!;
    expect(pca.owners[0].facts[0]).toMatchObject({ source: "ownership", evidence: "https://wiki.acmebank.example/dominios-e-times#time-catalogo" });
    expect(pca.matchedBy[0].path.map((h) => h.node.key)).toEqual([K.sysCatalog, K.domain]);
  });

  test("7. quem usa a biblioteca interna, e em que versão", async () => {
    const res = await q.libraryUsage("service-platform");
    const byComponent = Object.fromEntries(res.users.map((e) => [e.node.key, e.facts.find((f) => f.source === "sbom")!.props]));
    expect(byComponent[K.pca]).toEqual({ version: "2.3.1", scope: "compile", resolved: true, direct: true });
    // Declarado × usado vem de outra fonte, como outra afirmação da mesma relação.
    const pca = res.users.find((e) => e.node.key === K.pca)!;
    expect(pca.facts.find((f) => f.source === "dependency-usage")?.props).toEqual({ declared: true, used: true });
    expect(byComponent[K.lsa]).toMatchObject({ version: "3.0.0-RC1" });

    const old = await q.libraryUsage(K.platform, { versionRange: "<3.0.0" });
    expect(old.users.map((e) => e.node.key).sort()).toEqual([K.pca, K.lsa].sort()); // RC1 vem antes da 3.0.0
    const final = await q.libraryUsage(K.platform, { versionRange: ">=3.0.0" });
    expect(final.users).toEqual([]);
  });

  test("7b. versões em uso, e o uso direto ou pelo que traz a biblioteca", async () => {
    const res = await q.libraryUsage(K.platform);
    expect(res.versions.map((v) => v.version)).toEqual(["3.0.0-RC1", "2.3.1"]);
    expect(res.versions.find((v) => v.version === "2.3.1")!.components).toContain(K.pca);
    expect(res.users.every((u) => u.direct)).toBe(true);
    expect(res.users.find((u) => u.node.key === K.pca)).toMatchObject({ direct: true, version: "2.3.1" });

    const mongo = await q.libraryUsage("mongodb-driver-sync", { direct: false });
    const pca = mongo.users.find((u) => u.node.key === K.pca)!;
    // O SBOM diz transitiva; o build diz não declarada: chega pela biblioteca interna.
    expect(pca).toMatchObject({ direct: false, version: "4.11.1", via: [K.platform] });
    expect((await q.libraryUsage("mongodb-driver-sync", { direct: true })).users).toEqual([]);
  });

  test("7c. as bibliotecas de um componente: as diretas, e as transitivas sob pedido", async () => {
    const direct = await q.componentLibraries("product-catalog-api");
    expect(direct.libraries.map((l) => l.node.key)).toEqual([K.platform]);
    expect(direct.counts).toEqual({ direct: 1, transitive: 1, unused: 0 });
    expect(direct.libraries[0]).toMatchObject({ direct: true, version: "2.3.1" });

    const all = await q.componentLibraries(K.pca, { transitive: true });
    expect(all.libraries.map((l) => [l.node.key, l.direct, l.via])).toEqual([
      [K.platform, true, undefined],
      ["lib:maven/org.mongodb:mongodb-driver-sync", false, [K.platform]],
    ]);
    expect((await q.componentLibraries(K.pca, { unused: true })).libraries).toEqual([]);
  });

  test("8. por onde passa uma requisição para o host", async () => {
    const res = await q.routeGet("Product-Catalog-API.dev.acmebank.example");
    expect(res.routes).toHaveLength(1);
    const [r] = res.routes;
    expect(r.entry).toMatchObject({ key: K.ingress, kind: "ingress" });
    expect(r.to.key).toBe(K.pca);
    expect(r.facts[0]).toMatchObject({ source: "k8s-routes", evidence: "k8s://dev/credito/ingress/product-catalog-api" });
    expect(r.provides.map((e) => e.node.key)).toEqual([K.pcaApi]);
  });
});

describe("contract_get", () => {
  test("sem endpoint: APIs, contratos e endpoints com hasContract, sem o conteúdo", async () => {
    const res = (await q.contractGet("product-catalog-api")) as Record<string, any>;
    expect(res.contract).toBeUndefined();
    const [api] = res.apis;
    expect(api.api.key).toBe(K.pcaApi);
    expect(api.contracts.map((e: { node: { key: string } }) => e.node.key)).toContain(K.openapi);
    const byKey = Object.fromEntries(api.endpoints.map((e: { node: { key: string } }) => [e.node.key, e]));
    expect(byKey[K.epCreate]).toMatchObject({ method: "POST", path: "/products", operationId: "createProduct", hasContract: true });
    expect(byKey[K.epCreate].direction).toBe("out");
    expect(byKey[K.epGetOne]).toMatchObject({ hasContract: false });
    expect(JSON.stringify(res)).not.toContain("CreateProductRequest");
  });

  test("com endpoint: o contrato parseado, as afirmações de HAS_ENDPOINT e os contratos da API", async () => {
    const res = (await q.contractGet(K.pca, { endpoint: "post /products" })) as Record<string, any>;
    expect(res.endpoint.key).toBe(K.epCreate);
    expect(res.endpoint.props).not.toHaveProperty("contract");
    expect(res.contract).toEqual(createProductContract);
    expect(res.apis[0].node.key).toBe(K.pcaApi);
    expect(res.apis[0].direction).toBe("in");
    expect(res.apis[0].facts[0].source).toBe("openapi");
    expect(res.apis[0].facts[0].evidence).toMatch(/#\/paths\/~1products\/post$/);
    expect(res.apis[0].contracts.map((e: { node: { key: string } }) => e.node.key)).toContain(K.openapi);
    expect(res.coverage).toBeUndefined();
  });

  test("endpoint pelo operationId", async () => {
    const res = (await q.contractGet(K.pca, { endpoint: "createProduct" })) as Record<string, any>;
    expect(res.endpoint.key).toBe(K.epCreate);
  });

  test("endpoint sem contrato vem com coverage; inexistente é 404", async () => {
    const res = (await q.contractGet(K.pcaApi, { endpoint: K.epGetOne })) as Record<string, any>;
    expect(res.contract).toBeUndefined();
    expect(res.coverage.contract.note).toContain("sem dados");
    await expect(q.contractGet(K.pca, { endpoint: "DELETE /products" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("consultas", () => {
  test("component_get: dono, sistema e domínio, repositório, stack, APIs, gateways", async () => {
    const res = await q.componentGet(K.lsa);
    expect(res.component).toMatchObject({ props: { name: "loan-simulation-api", kind: "service" }, referenced: false });
    expect(res.component.facts.map((f) => f.source)).toEqual(["gitlab"]);
    expect(res.owners[0].node.key).toBe(K.teamSimulation);
    expect(res.systems[0].node.key).toBe(K.sysSimulation);
    expect(res.systems[0].domains[0].node.key).toBe(K.domain);
    expect(res.repositories[0].node.key).toBe("repo:gitlab/acme/credito/loan-simulation-api");
    expect(res.stack.map((e) => `${e.node.key}@${e.facts[0].props!.version}`).sort()).toEqual([`${K.java}@21`, `${K.springBoot}@3.3.0`]);
    expect(res.provides[0]).toMatchObject({ node: { key: K.lsaApi }, direction: "out" });
    expect(res.reachesVia[0].node.key).toBe(K.ingress);
    expect(res.libraries.count).toBe(2);
  });

  test("dados: component_get traz os datasets com dono, leitura e escrita; dataset_get, quem acessa", async () => {
    const pca = await q.componentGet(K.pca);
    expect(pca.data.map((d) => d.dataset.key)).toEqual([K.products, K.sequences]);
    const products = pca.data[0];
    expect(products.dataset).toMatchObject({ type: "Dataset", name: "products", kind: "collection" });
    expect(products.owns![0].source).toBe("data-access");
    expect(products.writes![0].evidence).toBe("acme/credito/product-catalog-api@a1b2c3d:src/main/java/org/acme/MongoProductRepository.java#L25");
    expect(pca.coverage?.data).toBeUndefined();

    const lsa = await q.componentGet(K.lsa);
    expect(lsa.data).toEqual([]);
    expect(lsa.coverage!.data!.sources.map((x) => x.source)).toEqual(["data-access"]);

    const ds = await q.datasetGet("products");
    expect(ds.dataset.props).toMatchObject({ store: "document" });
    expect(ds.owners.map((e) => e.node.key)).toEqual([K.pca]);
    expect(ds.readers.map((e) => e.node.key)).toEqual([K.pca]);
    expect(ds.writers.map((e) => e.node.key)).toEqual([K.pca]);
  });

  test("nó referenciado: apontado por uma relação, sem afirmação de existência", async () => {
    const res = await q.componentGet(K.pca);
    const repo = res.repositories[0];
    expect(repo.node.key).toBe("repo:gitlab/acme/credito/product-catalog-api");
    const { records } = await db.read(`MATCH (c:Claim)-[:CLAIMS]->(:Node {key: $k}) RETURN count(c) AS n`, { k: repo.node.key });
    expect(records[0].get("n")).toBe(0);
    const lib = await q.libraryUsage("mongodb-driver-sync");
    expect(lib.library.referenced).toBe(true);
    expect(lib.library.facts).toEqual([]);
  });

  test("component_dependencies: saída, entrada e transitivo", async () => {
    const out = await q.componentDependencies("loan-simulation-api");
    const outEdges = out.edges.map((e) => `${e.to}:${e.via.type}`).sort();
    expect(outEdges).toEqual([`${K.pca}:CALLS`, `${K.pca}:CALLS`, `${K.pca}:CONSUMES`, `${K.pca}:SUBSCRIBES`]);
    const consumes = out.edges.find((e) => e.via.type === "CONSUMES")!;
    expect(sources(consumes.facts.dependent)).toEqual(["pact-broker", "service-config"]);
    expect(sources(consumes.facts.provider)).toEqual(["openapi"]);
    expect(consumes.via.api).toBeUndefined();
    // Em CALLS, a API do provedor que tem o endpoint.
    expect(out.edges.filter((e) => e.via.type === "CALLS").map((e) => e.via.api?.key)).toEqual([K.pcaApi, K.pcaApi]);

    const into = await q.componentDependencies(K.pca, { direction: "in", depth: 2 });
    expect(Object.fromEntries(into.components.map((c) => [c.key, c.level]))).toEqual({ [K.pca]: 0, [K.lsa]: 1, [K.web]: 2 });

    const oneLevel = await q.componentDependencies(K.pca, { direction: "in" });
    expect(keys(oneLevel.components)).toEqual([K.lsa, K.pca].sort());
  });

  test("component_dependencies com kind: quais frontends dependem de X, com o caminho", async () => {
    const res = await q.componentDependenciesOfKind("product-catalog-api", { direction: "in", depth: 2, kind: "frontend" });
    expect(res.components.map((c) => [c.key, c.level])).toEqual([[K.web, 2]]);
    const [path] = res.components[0].paths;
    // No sentido da dependência: o frontend primeiro, passando pela loan-simulation-api.
    expect(path.map((h) => `${h.from}>${h.to}`)).toEqual([`${K.web}>${K.lsa}`, `${K.lsa}>${K.pca}`]);
    expect(path[0].via.map((v) => `${v.type} ${v.node.key}`)).toEqual([`CONSUMES ${K.lsaApi}`]);
    expect(path[1].via.map((v) => v.type).sort()).toEqual(["CALLS", "CALLS", "CONSUMES", "SUBSCRIBES"]);
    expect(res).not.toHaveProperty("coverage");

    // Um nível só não chega ao frontend: vazio, mas a cobertura diz que ele existe no grafo.
    const near = await q.componentDependenciesOfKind(K.pca, { direction: "in", kind: "frontend" });
    expect(near.components).toEqual([]);
    expect(near.coverage).toMatchObject({ componentsOfKind: 1 });
    // Nenhum bff publicado: vazio quer dizer sem dados.
    const bff = await q.componentDependenciesOfKind(K.pca, { direction: "in", depth: 5, kind: "bff" });
    expect(bff.coverage!.componentsOfKind).toBe(0);
    expect(bff.coverage!.note).toContain("Nenhum componente");

    // Na direção out, o caminho começa na raiz.
    const out = await q.componentDependenciesOfKind(K.web, { depth: 2, kind: "service" });
    expect(out.components.map((c) => c.key).sort()).toEqual([K.lsa, K.pca].sort());
    const toPca = out.components.find((c) => c.key === K.pca)!.paths[0];
    expect(toPca.map((h) => `${h.from}>${h.to}`)).toEqual([`${K.web}>${K.lsa}`, `${K.lsa}>${K.pca}`]);
  });

  test("org_structure: árvore, membros e o que cada grupo possui", async () => {
    const res = await q.orgStructure();
    expect(res.groups.map((g) => g.key)).toEqual([K.dept]);
    const [dept] = res.groups;
    expect(dept.owns.map((e) => e.node.key)).toEqual([K.domain]);
    const catalog = dept.groups.find((g) => g.key === K.teamCatalog)!;
    expect(catalog.members[0]).toMatchObject({ node: { key: K.ana }, facts: [{ source: "gitlab", props: { role: "maintainer" } }] });
    expect(catalog.owns.map((e) => e.node.key)).toEqual([K.pca]);
    expect(dept.parentFacts).toBeUndefined();
    expect(catalog.parentFacts!.map((f) => f.source)).toEqual(["ownership"]);

    // Nível de cada grupo, com as afirmações, e os níveis citados em ordem, com o que é time.
    expect(dept.level).toMatchObject([{ type: "AT_LEVEL", node: { key: K.levelTribe, name: "Tribo" }, facts: [{ source: "ownership" }] }]);
    expect(catalog.level.map((e) => e.node.key)).toEqual([K.levelTeam]);
    expect(res.levels.map((l) => [l.key, l.props.order, l.props.team])).toEqual([
      [K.levelTribe, 1, undefined],
      [K.levelTeam, 2, true],
    ]);

    const shallow = await q.orgStructure({ group: "Crédito", depth: 0 });
    expect(shallow.groups[0].groups).toEqual([]);
    expect(shallow.groups[0].moreGroups!.sort()).toEqual([K.teamCatalog, K.teamSimulation].sort());
    expect(shallow.levels.map((l) => l.key)).toEqual([K.levelTribe]);
  });

  test("people_list: pessoas com os grupos, filtro por grupo e por texto", async () => {
    const all = await q.peopleList();
    expect(all.people.map((p) => p.key)).toEqual([K.ana, K.bruno]);
    const [ana] = all.people;
    expect(ana.props.name).toBe("Ana");
    expect(ana.memberships).toEqual([
      expect.objectContaining({ type: "MEMBER_OF", direction: "out", node: expect.objectContaining({ key: K.teamCatalog, name: "Time Catálogo" }) }),
    ]);
    expect(ana.memberships[0].facts).toMatchObject([{ source: "gitlab", props: { role: "maintainer" } }]);

    expect((await q.peopleList({ group: "Time Simulação" })).people.map((p) => p.key)).toEqual([K.bruno]);
    // Só membros diretos: ninguém é membro do departamento.
    expect((await q.peopleList({ group: K.dept })).people).toEqual([]);
    expect((await q.peopleList({ text: "AN" })).people.map((p) => p.key)).toEqual([K.ana]);
    const page = await q.peopleList({ limit: 1 });
    expect(page).toMatchObject({ count: 1, truncated: true });
    await rejects(q.peopleList({ group: K.pca }), 422);
  });

  test("node_get de um sistema traz os domínios pela PART_OF", async () => {
    const res = await q.nodeGet(K.sysCatalog);
    expect(res.node).toMatchObject({ key: K.sysCatalog, status: "current" });
    const partOf = res.relations.find((r) => r.type === "PART_OF" && r.direction === "out")!;
    expect(partOf.edges.map((e) => e.node)).toEqual([expect.objectContaining({ key: K.domain, type: "Domain" })]);
  });

  test("components_list: filtros combinados e time com subgrupos", async () => {
    const team = await q.componentsList({ team: K.dept });
    expect(keys(team.components)).toEqual([K.lsa, K.web, K.job, K.pca].sort());
    const combo = await q.componentsList({ team: "Time Simulação", kind: "service", technology: "spring-boot" });
    expect(keys(combo.components)).toEqual([K.lsa]);
    expect(combo.components[0].matchedBy.map((m) => m.filter).sort()).toEqual(["team", "technology"]);
    // Sem filtro: os quatro. O nome antigo é apelido, não um quinto componente.
    expect((await q.componentsList({})).count).toBe(4);
  });

  test("route_get: prefixo mais longo e rota inexistente", async () => {
    const sim = await q.routeGet("api.dev.acmebank.example", { path: "/catalog/simulation/run" });
    expect(sim.routes.map((r) => r.to.key)).toEqual([K.lsa]);
    const cat = await q.routeGet("api.dev.acmebank.example", { path: "/catalog/products" });
    expect(cat.routes.map((r) => r.to.key)).toEqual([K.pca]);
    const all = await q.routeGet("api.dev.acmebank.example");
    expect(all.routes).toHaveLength(2);
    await rejects(q.routeGet("api.dev.acmebank.example", { path: "/outra" }), 404);
    await rejects(q.routeGet("nao-existe.acme"), 404);
  });

  test("referências: tipo errado, inexistente e ambígua", async () => {
    await rejects(q.componentGet(K.pcaApi), 422);
    await rejects(q.componentGet("component:nao-existe"), 404);
    await rejects(q.componentGet("nao-existe"), 404);
    // "credito" é o último segmento de domain:credito e de group:credito: ambíguo entre os dois tipos.
    const err = await rejects(db.readTx((tx) => resolveRef(tx, "credito", ["Domain", "Group"])), 409);
    expect(err.details).toEqual({ candidates: [{ key: K.domain, name: "Crédito" }, { key: K.dept, name: "Crédito" }] });
    expect((await db.readTx((tx) => resolveRef(tx, "credito", ["Group"]))).key).toBe(K.dept);
    await rejects(q.libraryUsage(K.platform, { versionRange: "abc" }), 422);
  });
});

describe("architecture_overview", () => {
  test("componentes, dependências, tópicos e cobertura numa chamada", async () => {
    const res = await q.architectureOverview();
    expect(keys(res.components)).toEqual([K.lsa, K.web, K.job, K.pca].sort());
    const pca = res.components.find((c) => c.key === K.pca)!;
    expect(pca.owners.map((o) => o.key)).toEqual([K.teamCatalog]);
    expect(pca.systems.map((o) => o.key)).toEqual([K.sysCatalog]);
    // O domínio de cada sistema, para o console agrupar por domínio.
    expect(pca.systems[0].domains).toEqual([expect.objectContaining({ key: K.domain, name: "Crédito" })]);
    expect(pca.provides[0]).toMatchObject({ key: K.pcaApi, kind: "http", endpoints: 3 });
    expect(pca.provides[0].contracts.sort()).toEqual([K.openapi, K.pact].sort());
    expect(pca.libraries).toBe(2); // só a contagem, nunca as DEPENDS_ON
    expect(pca.data.map((d) => d.dataset.name)).toEqual(["products", "sequences"]);
    // Recurso com o tipo e a instância, para desenhar o banco sem ler a chave.
    const lsa = res.components.find((c) => c.key === K.lsa)!;
    expect(lsa.resources).toEqual([
      expect.objectContaining({ key: K.pgDb, kind: "database", hostedOn: [expect.objectContaining({ key: K.pg })] }),
    ]);
    expect(sources(lsa.resources[0].facts)).toContain("service-config");

    const dep = res.dependencies.find((d) => d.from === K.lsa && d.to === K.pca)!;
    expect(dep.via.map((v) => v.type).sort()).toEqual(["CALLS", "CALLS", "CONSUMES", "SUBSCRIBES"]);
    const consumes = dep.via.find((v) => v.type === "CONSUMES")!;
    expect(sources(consumes.facts.dependent)).toEqual(["pact-broker", "service-config"]);
    expect(dep.via.filter((v) => v.type === "CALLS").map((v) => v.api)).toEqual([K.pcaApi, K.pcaApi]);
    // O método e o caminho de cada endpoint chamado, para o console mostrar sem ler a chave.
    expect(dep.via.filter((v) => v.type === "CALLS").every((v) => v.endpoint?.method && v.endpoint.path?.startsWith("/"))).toBe(true);

    const topic = res.topics.find((t) => t.key === K.topic)!;
    expect(topic.kind).toBe("topic"); // tópico ou fila
    expect(topic.publishers.map((p) => p.key)).toEqual([K.pca]);
    expect(topic.subscribers.map((p) => p.key)).toEqual([K.lsa]);
    expect(topic.hostedOn.map((h) => h.key)).toEqual([K.kafka]); // o broker em que o tópico está

    expect(res.nodes.current.Component).toBe(4);
    expect(res.nodes).not.toHaveProperty("staleHidden");
    expect(res.sources.map((x) => x.source)).toContain("sbom");
    expect(res).not.toHaveProperty("gaps"); // a fixture tem todas as fontes
  });

  test("vizinhança de um componente: níveis e as dependências entre os vizinhos", async () => {
    const res = await q.architectureOverview({ component: "loan-simulation-api" });
    expect(res.center).toBe(K.lsa);
    expect(res.components.map((c) => [c.key, c.level])).toEqual([
      [K.lsa, 0],
      [K.web, 1],
      [K.pca, 1],
    ].sort((a, b) => (a[1] as number) - (b[1] as number) || String(a[0]).localeCompare(String(b[0]))));
    expect(res.dependencies.map((d) => `${d.from}>${d.to}`).sort()).toEqual([`${K.lsa}>${K.pca}`, `${K.web}>${K.lsa}`].sort());
    expect(res.topics.map((t) => t.key)).toEqual([K.topic]);

    const wide = await q.architectureOverview({ component: K.web, depth: 2 });
    expect(wide.components.find((c) => c.key === K.pca)!.level).toBe(2);
    await rejects(q.architectureOverview({ component: K.lsa, team: K.teamCatalog }), 422);
  });

  test("recorte por time: os componentes do time e as dependências que entram ou saem", async () => {
    const res = await q.architectureOverview({ team: K.teamCatalog });
    expect(keys(res.components)).toEqual([K.pca]);
    expect(res.dependencies.map((d) => `${d.from}>${d.to}`)).toContain(`${K.lsa}>${K.pca}`);
  });
});

describe("busca, nó genérico, fontes e divergências", () => {
  test("nodes_find: nome, último segmento e apelido, exato primeiro", async () => {
    const byName = await q.nodesFind({ text: "product-catalog-api" });
    expect(byName.nodes[0].key).toBe(K.pca);
    expect(byName.nodes.map((n) => n.key)).toContain(K.pcaApi);

    const byAlias = await q.nodesFind({ text: "component:product-catalog", types: ["Component"] });
    expect(byAlias.nodes.map((n) => n.key)).toEqual([K.pca]);

    const systems = await q.nodesFind({ types: ["System"] });
    expect(keys(systems.nodes)).toEqual([K.sysCatalog, K.sysSimulation].sort());

    const limited = await q.nodesFind({ text: "credito", limit: 2 });
    expect(limited).toMatchObject({ count: 2, truncated: true });
  });

  test("nodes_find com referencedOnly: só pontas de relação", async () => {
    const { nodes } = await q.nodesFind({ referencedOnly: true, limit: 500 });
    expect(nodes.every((n) => n.referenced)).toBe(true);
    expect(nodes.map((n) => n.key)).toContain("repo:gitlab/acme/credito/product-catalog-api");
    expect(nodes.map((n) => n.key)).not.toContain(K.pca);
  });

  test("node_get: relações de um sistema agrupadas por tipo e direção, com as afirmações", async () => {
    const { node, relations } = await q.nodeGet("Catálogo");
    expect(node.key).toBe(K.sysCatalog);
    const partOfOut = relations.find((g) => g.type === "PART_OF" && g.direction === "out")!;
    expect(partOfOut.edges.map((e) => e.node.key)).toEqual([K.domain]);
    const partOfIn = relations.find((g) => g.type === "PART_OF" && g.direction === "in")!;
    expect(partOfIn).toMatchObject({ total: 1 });
    expect(partOfIn.edges[0]).toMatchObject({ node: { key: K.pca }, direction: "in" });
    expect(sources(partOfIn.edges[0].facts)).toEqual(["gitlab"]);
  });

  test("sources_status: escopos com o último retrato, cargas recentes e cobertura por tipo de fato", async () => {
    const { sources: all, loads, coverage } = await q.sourcesStatus();
    const sbomSource = all.find((s) => s.source === "sbom")!;
    expect(sbomSource.scopeCount).toBe(2);
    expect(sbomSource.scopes[0]).toMatchObject({ scope: { component: "loan-simulation-api" } });
    expect(sbomSource.scopes[0].counts).toHaveProperty("relations");
    expect(loads[0].receivedAt >= loads[loads.length - 1].receivedAt).toBe(true);
    expect(coverage.find((c) => c.kind === "owners")!.sources.map((s) => s.source)).toEqual(["ownership"]);

    const only = await q.sourcesStatus({ source: "gitlab" });
    expect(only.sources.map((s) => s.source)).toEqual(["gitlab"]);
    expect(only.loads.every((l) => l.source === "gitlab")).toBe(true);
  });

  test("fact_divergences: SBOM e declarado × usado se completam na mesma dependência, sem divergir", async () => {
    const { divergences } = await q.factDivergences({ relationType: "DEPENDS_ON", node: K.pca });
    expect(divergences.find((d) => d.edges[0].node.key === K.platform)).toBeUndefined();
  });
});

describe("divergência e retrato (escrevem no grafo)", () => {
  test("fact_divergences: dois donos para o mesmo componente", async () => {
    const res = await post("POST", "/v1/ingest", {
      source: "service-catalog",
      scope: { component: "product-catalog-api" },
      observedAt: "2026-09-29T10:30:00Z",
      evidenceBase: "product-catalog-api@a1b2c3d:catalog-info.yaml",
      relations: [{ type: "OWNED_BY", from: K.pca, to: K.teamSimulation }],
    });
    expect(res.statusCode).toBe(200);
    const { divergences } = await q.factDivergences({ relationType: "OWNED_BY" });
    expect(divergences).toHaveLength(1);
    const [owners] = divergences;
    expect(owners).toMatchObject({ kind: "targets", from: { key: K.pca } });
    expect(owners.edges.map((e) => `${e.node.key}:${sources(e.facts)}`).sort()).toEqual(
      [`${K.teamCatalog}:ownership`, `${K.teamSimulation}:service-catalog`].sort(),
    );
  });

  test("duas fontes com versões diferentes aparecem lado a lado", async () => {
    const res = await post("POST", "/v1/ingest", {
      source: "gitlab-ci",
      scope: { component: "product-catalog-api" },
      observedAt: "2026-09-29T11:00:00Z",
      evidenceBase: "product-catalog-api@a1b2c3d:.gitlab-ci.yml:4",
      relations: [{ type: "BUILT_WITH", from: K.pca, to: K.springBoot, props: { version: "3.2.0" } }],
    });
    expect(res.statusCode).toBe(200);
    const { stack } = await q.componentGet(K.pca);
    const spring = stack.find((e) => e.node.key === K.springBoot)!;
    expect(spring.facts.map((f) => `${f.source}:${f.props!.version}`).sort()).toEqual(["gitlab-ci:3.2.0", "sbom:3.2.4"]);
    const { divergences } = await q.factDivergences({ relationType: "BUILT_WITH", node: K.pca });
    const versions = divergences.find((d) => d.edges[0].node.key === K.springBoot)!;
    expect(versions).toMatchObject({ kind: "props", from: { key: K.pca }, props: ["version"] });
    expect(sources(versions.edges[0].facts)).toEqual(["gitlab-ci", "sbom"]);
  });

  test("stale fica de fora por padrão e volta com includeStale", async () => {
    // Novo retrato do sbom da product-catalog-api sem a biblioteca interna: a dependência vira stale.
    const [pcaSbom] = sbom;
    const res = await post("POST", "/v1/ingest", {
      ...pcaSbom,
      observedAt: "2026-09-29T12:00:00Z",
      relations: pcaSbom.relations!.filter((r) => r.to !== K.platform),
    });
    expect(res.statusCode).toBe(200);

    // A relação continua pela outra fonte (dependency-usage), só com a afirmação dela.
    const current = await q.libraryUsage(K.platform);
    expect(current.users.map((e) => e.node.key).sort()).toEqual([K.lsa, K.pca].sort());
    const pca = current.users.find((e) => e.node.key === K.pca)!;
    expect(pca.facts.map((f) => f.source)).toEqual(["dependency-usage"]);
    const withStale = await q.libraryUsage(K.platform, { includeStale: true });
    const stale = withStale.users.find((e) => e.node.key === K.pca)!.facts.find((f) => f.source === "sbom")!;
    expect(stale).toMatchObject({ status: "stale", props: { version: "2.3.1" } });
  });
});

describe("vigência dos nós (escreve no grafo)", () => {
  test("nó que nenhuma fonte afirma mais fica stale e sai do retrato", async () => {
    // Novo retrato do openapi da product-catalog-api sem o POST e sem o contrato.
    const [pcaOpenapi] = openapi;
    const res = await post("POST", "/v1/ingest", {
      ...pcaOpenapi,
      observedAt: "2026-09-29T13:00:00Z",
      nodes: pcaOpenapi.nodes!.filter((n) => n.key !== K.epCreate && n.key !== K.openapi),
      relations: pcaOpenapi.relations!.filter((r) => r.to !== K.epCreate && r.to !== K.openapi),
    });
    expect(res.statusCode).toBe(200);

    const status = async (k: string) =>
      (await db.read("MATCH (n:Node {key: $k}) RETURN n.status AS s", { k })).records[0].get("s");
    expect(await status(K.epCreate)).toBe("stale");
    expect(await status(K.openapi)).toBe("stale");
    // O endpoint que o pact ainda chama continua current, mesmo se o openapi deixar de afirmá-lo.
    expect(await status(K.epGetOne)).toBe("current");

    const overview = await q.architectureOverview();
    expect(overview.nodes.staleHidden).toEqual({ Contract: 1, Endpoint: 1 });
    const pca = overview.components.find((c) => c.key === K.pca)!;
    expect(pca.provides[0].endpoints).toBe(2);
    expect(pca.provides[0].contracts).toEqual([K.pact]);
  });

  test("renomeado: o nome antigo sai da lista e não disputa com o novo", async () => {
    const load = (key: string, at: string) =>
      post("POST", "/v1/ingest", {
        source: "gitlab",
        scope: { project: "acme/outro/renomeado" },
        observedAt: at,
        evidenceBase: "https://gitlab.acmebank.example/",
        nodes: [{ key, type: "Component", props: { name: "renomeado", kind: "service" }, evidence: "acme/outro/renomeado" }],
      });
    expect((await load("component:acme/outro/antigo/renomeado", "2026-09-29T14:00:00Z")).statusCode).toBe(200);
    expect((await load("component:acme/outro/renomeado", "2026-09-29T14:01:00Z")).statusCode).toBe(200);

    const list = await q.componentsList({});
    expect(keys(list.components)).toContain("component:acme/outro/renomeado");
    expect(keys(list.components)).not.toContain("component:acme/outro/antigo/renomeado");
    const withStale = await q.componentsList({ includeStale: true });
    const old = withStale.components.find((c) => c.key === "component:acme/outro/antigo/renomeado")!;
    expect(old.status).toBe("stale");

    // "renomeado" casa com os dois pelo último segmento; só o current conta.
    expect((await q.componentGet("renomeado")).component.key).toBe("component:acme/outro/renomeado");
  });
});

describe("infraestrutura implantável (escreve no grafo)", () => {
  test("o banco usado chega ao componente de infraestrutura pela instância (HOSTED_ON → INSTANCE_OF)", async () => {
    const infra = "component:acme/infra/postgresql";
    const catalog = await post("POST", "/v1/ingest", {
      source: "service-catalog",
      scope: { catalog: "acme-infra" },
      observedAt: "2026-09-29T13:00:00Z",
      evidenceBase: "https://catalog.acmebank.example/",
      nodes: [{ key: infra, type: "Component", props: { kind: "infra", name: "postgresql" }, evidence: "components/postgresql" }],
    });
    expect(catalog.statusCode).toBe(200);
    const cluster = await post("POST", "/v1/ingest", {
      source: "k8s-infra",
      scope: { cluster: "dev", what: "catalogo" },
      observedAt: "2026-09-29T13:00:00Z",
      evidenceBase: "k8s://dev/",
      relations: [{ type: "INSTANCE_OF", from: K.pg, to: infra, evidence: "infra/statefulset/postgresql#metadata.labels.app" }],
    });
    expect(cluster.statusCode).toBe(200);

    const res = await q.architectureOverview();
    const lsa = res.components.find((c) => c.key === K.lsa)!;
    const [host] = lsa.resources.find((r) => r.key === K.pgDb)!.hostedOn;
    expect(host).toMatchObject({ key: K.pg, instanceOf: { key: infra, name: "postgresql" } });
    expect(sources(host.instanceOf!.facts)).toEqual(["k8s-infra"]);
    expect(res.components.find((c) => c.key === infra)).toMatchObject({ kind: "infra" });
  });

  test("o tópico chega ao componente do broker pela instância", async () => {
    const infra = "component:acme/infra/kafka";
    await post("POST", "/v1/ingest", {
      source: "service-catalog",
      scope: { catalog: "acme-infra-kafka" },
      observedAt: "2026-09-29T13:00:00Z",
      evidenceBase: "https://catalog.acmebank.example/",
      nodes: [{ key: infra, type: "Component", props: { kind: "infra", name: "kafka" }, evidence: "components/kafka" }],
    });
    await post("POST", "/v1/ingest", {
      source: "k8s-infra",
      scope: { cluster: "dev", what: "catalogo-kafka" },
      observedAt: "2026-09-29T13:00:00Z",
      evidenceBase: "k8s://dev/",
      relations: [{ type: "INSTANCE_OF", from: K.kafka, to: infra, evidence: "infra/statefulset/kafka#spec.selector.matchLabels.app" }],
    });

    const res = await q.architectureOverview();
    const [host] = res.topics.find((t) => t.key === K.topic)!.hostedOn;
    expect(host).toMatchObject({ key: K.kafka, instanceOf: { key: infra, name: "kafka" } });
    expect(sources(host.facts)).toEqual(["service-config"]);
  });

  test("cada recurso traz o ambiente, e o recorte por ambiente deixa só os recursos dele", async () => {
    const prd = "env:prd";
    const server = "resource:prd/mongodb";
    const database = "resource:prd/mongodb/product-catalog";
    await post("POST", "/v1/ingest", {
      source: "k8s-infra",
      scope: { cluster: "prd" },
      observedAt: "2026-09-29T13:00:00Z",
      evidenceBase: "k8s://prd/",
      nodes: [
        { key: prd, type: "Environment", props: { name: "prd", kind: "production" }, evidence: "cluster" },
        { key: server, type: "Resource", props: { kind: "database-server", name: "mongodb" }, evidence: "infra/statefulset/mongodb" },
      ],
      relations: [{ type: "IN_ENVIRONMENT", from: server, to: prd, evidence: "infra/statefulset/mongodb" }],
    });
    await post("POST", "/v1/ingest", {
      source: "service-config",
      scope: { component: "product-catalog-api", environment: "prd" },
      observedAt: "2026-09-29T13:00:00Z",
      evidenceBase: "helm://prd/product-catalog-api#",
      nodes: [{ key: database, type: "Resource", props: { kind: "database", name: "product-catalog" }, evidence: "env.MONGODB_URI" }],
      relations: [
        { type: "HOSTED_ON", from: database, to: server, evidence: "env.MONGODB_URI" },
        { type: "USES_RESOURCE", from: K.pca, to: database, props: { access: "read-write" }, evidence: "env.MONGODB_URI" },
      ],
    });

    const all = await q.architectureOverview();
    const pca = all.components.find((c) => c.key === K.pca)!;
    expect(keys(pca.resources)).toEqual([K.mongoDb, database].sort());
    const prdDb = pca.resources.find((r) => r.key === database)!;
    expect(prdDb.environments).toEqual([]);
    expect(prdDb.hostedOn[0].environments).toMatchObject([{ key: prd, name: "prd", kind: "production" }]);

    const onlyPrd = await q.architectureOverview({ environment: "prd" });
    expect(onlyPrd.environment).toBe(prd);
    expect(keys(onlyPrd.components.find((c) => c.key === K.pca)!.resources)).toEqual([database]);
    expect(onlyPrd.components.find((c) => c.key === K.lsa)!.resources).toEqual([]);
    expect(onlyPrd.topics.find((t) => t.key === K.topic)!.hostedOn).toEqual([]); // o Kafka só está em dev

    const onlyDev = await q.architectureOverview({ environment: K.dev });
    expect(keys(onlyDev.components.find((c) => c.key === K.pca)!.resources)).toEqual([K.mongoDb]);
    expect(onlyDev.topics.find((t) => t.key === K.topic)!.hostedOn.map((h) => h.key)).toEqual([K.kafka]);

    await rejects(q.architectureOverview({ environment: "env:qa" }), 404);
  });
});

describe("versões", () => {
  test("comparação e faixas", () => {
    expect(compareVersions("3.10.0", "3.9.1")).toBe(1);
    expect(compareVersions("1.0.0-RC1", "1.0.0")).toBe(-1);
    expect(compareVersions("5.3.0.RELEASE", "5.3.0")).toBe(0);
    expect(compareVersions("2", "2.0.0")).toBe(0);
    expect(satisfies("2.5.1", parseRange(">=2.0 <3.0"))).toBe(true);
    expect(satisfies("3.0.0", parseRange(">=2.0 <3.0"))).toBe(false);
    expect(satisfies("1.4.2", parseRange("1.4.2"))).toBe(true);
  });
});
