import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { QueryService } from "../src/query/QueryService";
import { endpointKey, httpApiKey, topicKey } from "@panorama-graph/sdk";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

// APIs e tópicos versionados: um nó por versão, com `version`, e quem consome cada versão.
const db = createTestDb();
const q = new QueryService(db);
let app: FastifyInstance;

// Versão no código: as duas versões são rotas do mesmo serviço.
const provider = "component:example/catalog/product-api";
const oldClient = "component:example/checkout/cart-api";
const newClient = "component:example/checkout/order-api";
const v1 = httpApiKey("product-api", "v1");
const v2 = httpApiKey("product-api", "v2");
const topicV1 = topicKey("product-created.v1");
const topicV2 = topicKey("product-created.v2");

// Versão na infraestrutura: o código não sabe da versão; o cluster expõe o serviço como stock-api-v2.
const stock = "component:example/stock/stock-api";
const stockApi = httpApiKey("stock-api");
const stockV2 = httpApiKey("stock-api", "v2");
const stockV3 = httpApiKey("stock-api", "v3");
const getItem = endpointKey("stock-api", "GET", "/items/{id}");
const legacyClient = "component:example/checkout/legacy-api";

const loads = [
  {
    source: "openapi",
    scope: { component: "example/catalog/product-api" },
    evidenceBase: "example/catalog/product-api@abc:",
    nodes: [
      { key: v1, type: "Api", props: { kind: "http", version: "v1" } },
      { key: v2, type: "Api", props: { kind: "http", version: "v2" } },
      { key: endpointKey("product-api", "GET", "/v1/products", "v1"), type: "Endpoint", props: { method: "GET", path: "/v1/products" } },
      { key: endpointKey("product-api", "GET", "/v2/products", "v2"), type: "Endpoint", props: { method: "GET", path: "/v2/products" } },
    ],
    relations: [
      { type: "PROVIDES", from: provider, to: v1 },
      { type: "PROVIDES", from: provider, to: v2 },
      { type: "HAS_ENDPOINT", from: v1, to: endpointKey("product-api", "GET", "/v1/products", "v1") },
      { type: "HAS_ENDPOINT", from: v2, to: endpointKey("product-api", "GET", "/v2/products", "v2") },
    ],
  },
  {
    source: "asyncapi",
    scope: { component: "example/catalog/product-api" },
    evidenceBase: "example/catalog/product-api@abc:",
    nodes: [
      { key: topicV1, type: "Topic", props: { name: "product-created.v1", version: "v1" } },
      { key: topicV2, type: "Topic", props: { name: "product-created.v2", version: "v2" } },
    ],
    relations: [
      { type: "PUBLISHES", from: provider, to: topicV1 },
      { type: "PUBLISHES", from: provider, to: topicV2 },
    ],
  },
  {
    source: "openapi",
    scope: { component: "example/stock/stock-api" },
    evidenceBase: "example/stock/stock-api@123:",
    nodes: [
      { key: stockApi, type: "Api", props: { kind: "http" } },
      { key: getItem, type: "Endpoint", props: { method: "GET", path: "/items/{id}" } },
    ],
    relations: [
      { type: "PROVIDES", from: stock, to: stockApi },
      { type: "HAS_ENDPOINT", from: stockApi, to: getItem },
    ],
  },
  {
    source: "k8s-deployments",
    scope: { cluster: "dev", namespace: "stock" },
    evidenceBase: "k8s://dev/stock/",
    nodes: [
      { key: stockV2, type: "Api", props: { name: "stock-api-v2", kind: "http", version: "v2" }, evidence: "service/stock-api-v2" },
      { key: stockV3, type: "Api", props: { name: "stock-api-v3", kind: "http", version: "v3" }, evidence: "service/stock-api-v3" },
    ],
    relations: [
      { type: "PROVIDES", from: stock, to: stockV2, evidence: "service/stock-api-v2" },
      { type: "VERSION_OF", from: stockV2, to: stockApi, evidence: "service/stock-api-v2" },
      { type: "PROVIDES", from: stock, to: stockV3, evidence: "service/stock-api-v3" },
      { type: "VERSION_OF", from: stockV3, to: stockApi, evidence: "service/stock-api-v3" },
    ],
  },
  {
    source: "http-clients",
    scope: { component: "example/checkout/cart-api" },
    evidenceBase: "example/checkout/cart-api@def:",
    relations: [
      { type: "CONSUMES", from: oldClient, to: v1 },
      { type: "CALLS", from: oldClient, to: endpointKey("product-api", "GET", "/v1/products", "v1") },
      { type: "SUBSCRIBES", from: oldClient, to: topicV1 },
      { type: "CONSUMES", from: oldClient, to: stockV3 },
      { type: "CALLS", from: oldClient, to: getItem },
    ],
  },
  {
    source: "http-clients",
    scope: { component: "example/checkout/order-api" },
    evidenceBase: "example/checkout/order-api@fed:",
    relations: [
      { type: "CONSUMES", from: newClient, to: v2 },
      { type: "SUBSCRIBES", from: newClient, to: topicV2 },
    ],
  },
  {
    source: "http-clients",
    scope: { component: "example/checkout/legacy-api" },
    evidenceBase: "example/checkout/legacy-api@aaa:",
    relations: [
      { type: "CONSUMES", from: legacyClient, to: stockV2 },
      { type: "CALLS", from: legacyClient, to: getItem },
    ],
  },
];

beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger });
  await resetDatabase(db);
  let t = Date.UTC(2026, 9, 21, 9, 0, 0);
  for (const load of loads) {
    const res = await app.inject({ method: "POST", url: "/v1/ingest", payload: { ...load, observedAt: new Date((t += 1000)).toISOString() } });
    if (res.statusCode >= 300) throw new Error(`carga falhou (${res.statusCode}): ${res.body}`);
  }
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const versionsByConsumer = (res: Awaited<ReturnType<QueryService["apiConsumers"]>>) =>
  Object.fromEntries(res.consumers.map((c) => [c.component.key, c.consumes.map((e) => e.node.version)]));

describe("versão no código (caminho)", () => {
  test("quem consome uma versão da API: a API daquela versão", async () => {
    const res = await q.apiConsumers(v1);
    expect(res.apis).toEqual([v1]);
    expect(res.consumers.map((c) => c.component.key)).toEqual([oldClient]);
    expect(res.consumers[0].consumes[0].node).toMatchObject({ key: v1, version: "v1" });
  });

  test("pelo componente, todas as versões, cada consumidor na versão que chama", async () => {
    const res = await q.apiConsumers(provider);
    expect(res.apis.sort()).toEqual([v1, v2]);
    expect(versionsByConsumer(res)).toEqual({ [oldClient]: ["v1"], [newClient]: ["v2"] });
  });
});

describe("todas as versões da API", () => {
  test("pedida uma versão, `versions` traz a família; allVersions, os consumidores de todas", async () => {
    const one = await q.apiConsumers(v1);
    expect(one.versions).toEqual([{ key: v1, version: "v1" }, { key: v2, version: "v2" }]);
    expect(one.allVersions).toBeUndefined();

    const all = await q.apiConsumers(v1, { allVersions: true });
    expect(all.allVersions).toBe(true);
    expect(all.apis.sort()).toEqual([v1, v2]);
    expect(versionsByConsumer(all)).toEqual({ [oldClient]: ["v1"], [newClient]: ["v2"] });
  });

  test("a versão exposta na infraestrutura é da mesma família que a API do código", async () => {
    const res = await q.apiConsumers(stockV2, { allVersions: true });
    expect(res.versions!.map((v) => v.key)).toEqual([stockApi, stockV2, stockV3]);
    expect(versionsByConsumer(res)).toEqual({ [legacyClient]: ["v2"], [oldClient]: ["v3"] });
    // juntando as versões, cada consumidor vem com as chamadas que faz, e não só os da versão pedida
    expect(res.consumers.find((c) => c.component.key === oldClient)!.calls.map((e) => e.node.key)).toEqual([getItem]);
  });

  test("pedido o componente, não há uma família só", async () => {
    expect((await q.apiConsumers(provider)).versions).toBeUndefined();
  });
});

describe("versão na infraestrutura (VERSION_OF, da implantação)", () => {
  test("a versão exposta tem os endpoints da API do código, chamados só por quem a consome", async () => {
    const res = await q.apiConsumers(stockV2);
    expect(res.consumers.map((c) => c.component.key)).toEqual([legacyClient]);
    expect(res.consumers[0].calls.map((e) => e.node.key)).toEqual([getItem]);

    const one = await q.apiConsumers(stockV3, { endpoint: "GET /items/{id}" });
    expect(one.endpoint).toBe(getItem);
    expect(one.consumers.map((c) => c.component.key)).toEqual([oldClient]);
  });

  test("pela API do código ou pelo componente, os consumidores de todas as versões expostas", async () => {
    const byApi = await q.apiConsumers(stockApi);
    expect(byApi.apis.sort()).toEqual([stockApi, stockV2, stockV3]);
    expect(versionsByConsumer(byApi)).toEqual({ [legacyClient]: ["v2"], [oldClient]: ["v3"] });

    const byComponent = await q.apiConsumers(stock);
    expect(byComponent.apis.sort()).toEqual([stockApi, stockV2, stockV3]);
    expect(byComponent.consumers.map((c) => c.component.key).sort()).toEqual([oldClient, legacyClient].sort());
  });

  test("o consumidor da versão exposta depende do componente que a oferece", async () => {
    const res = await q.componentDependencies(stock, { direction: "in" });
    expect(res.components.map((c) => c.key).filter((k) => k !== stock).sort()).toEqual([oldClient, legacyClient].sort());
  });
});

describe("tópicos", () => {
  test("cada versão do tópico é um tópico, com a versão", async () => {
    const res = await q.topicGet("product-created.v2");
    expect(res.subscribers.map((e) => e.node.key)).toEqual([newClient]);
    const found = await q.nodesFind({ text: "product-created", types: ["Topic"] });
    expect(found.nodes.map((n) => [n.key, n.version])).toEqual([
      [topicV1, "v1"],
      [topicV2, "v2"],
    ]);
  });

  test("`versions` traz as versões do mesmo tópico; com allVersions, os assinantes de todas, com a versão", async () => {
    const one = await q.topicGet(topicV1);
    expect(one.versions).toEqual([{ key: topicV1, version: "v1" }, { key: topicV2, version: "v2" }]);
    expect(one.subscribers.map((e) => e.node.key)).toEqual([oldClient]);

    const all = await q.topicGet(topicV1, { allVersions: true });
    expect(all.topic.key).toBe(topicV1);
    expect(all.subscribers.map((e) => [e.node.key, e.topic, e.version])).toEqual([
      [oldClient, topicV1, "v1"],
      [newClient, topicV2, "v2"],
    ]);
    expect(all.publishers.map((e) => e.version)).toEqual(["v1", "v2"]);
  });

  test("pelo nome sem a versão, todas as versões, com a mais nova como tópico", async () => {
    const res = await q.topicGet("product-created");
    expect(res.allVersions).toBe(true);
    expect(res.topic.key).toBe(topicV2);
    expect(res.subscribers.map((e) => e.version)).toEqual(["v1", "v2"]);
  });

  test("uma versão que não existe continua não encontrada", async () => {
    await expect(q.topicGet("product-created.v9")).rejects.toMatchObject({ statusCode: 404 });
  });
});

test("a versão vale só para interfaces: componente não a recebe pela carga", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    payload: {
      source: "gitlab",
      scope: { component: "example/catalog/product-api" },
      evidenceBase: "x",
      observedAt: new Date().toISOString(),
      nodes: [{ key: provider, type: "Component", props: { kind: "service", version: "v1" } }],
    },
  });
  expect(res.statusCode).toBe(422);
});
