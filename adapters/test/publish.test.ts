import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "../src/core/snapshot";
import { createContext } from "../src/graph-publish/artifacts/context";
import { mapAsyncApi } from "../src/graph-publish/artifacts/asyncapi";
import { mapManifest } from "../src/graph-publish/artifacts/manifest";
import { mapDataAccess } from "../src/graph-publish/artifacts/data-access";
import { mapHttpClients, operationsByService } from "../src/graph-publish/artifacts/http-clients";
import { MAX_CONTRACT_CHARS, mapOpenApi, operationContract } from "../src/graph-publish/artifacts/openapi";
import { mapPacts } from "../src/graph-publish/artifacts/pact";
import { bringers, dependencyTree, type CycloneDx } from "../src/graph-publish/artifacts/sbom";
import { planPublish } from "../src/graph-publish/publish";

/** Artefatos reais de build/architecture, gerados pelo plugin Gradle nos dois serviços de exemplo do ACME Bank. */
const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const AT = "2026-09-29T12:00:00.000Z";

const PCA = "component:acme/credito/product-catalog-api";
const LSA = "component:acme/credito/loan-simulation-api";

const bySource = (snapshots: Snapshot[]) => Object.fromEntries(snapshots.map((s) => [s.source, s]));
const rel = (s: Snapshot, type: string, to?: string) => s.relations.filter((r) => r.type === type && (!to || r.to === to));

describe("graph-publish sobre a product-catalog-api", () => {
  const plan = planPublish(fixture("product-catalog-api"), AT, { env: {} });
  const s = bySource(plan.snapshots);

  test("identidade pelo manifesto: caminho do repositório, commit e nome de serviço", () => {
    expect(plan.identity).toMatchObject({ path: "acme/credito/product-catalog-api", host: "gitlab.acmebank.example", service: "product-catalog" });
    expect(plan.identity.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test("um retrato por fonte, com escopo = componente e evidência repo@sha", () => {
    expect(Object.keys(s).sort()).toEqual(["asyncapi", "build-manifest", "data-access", "dependency-usage", "http-clients", "openapi", "sbom"]);
    for (const snap of plan.snapshots) {
      expect(snap.scope).toEqual({ component: "acme/credito/product-catalog-api" });
      expect(snap.evidenceBase).toBe(`acme/credito/product-catalog-api@${plan.identity.commit}:`);
      expect(snap.observedAt).toBe(AT);
    }
    expect(plan.skipped).toEqual(["pact (pacts/)"]);
  });

  test("cada retrato diz de que versão é; com --revision, o escopo leva o commit (retrato congelado)", () => {
    for (const snap of plan.snapshots) {
      expect(snap.revision).toEqual({ component: PCA, commit: plan.identity.commit, version: "0.0.0-SNAPSHOT" });
    }
    const frozen = planPublish(fixture("product-catalog-api"), AT, { env: {}, frozen: true, version: "1.0.0", overrides: { commit: "abc123" } });
    for (const snap of frozen.snapshots) {
      expect(snap.scope).toEqual({ component: "acme/credito/product-catalog-api", commit: "abc123" });
      expect(snap.revision).toEqual({ component: PCA, commit: "abc123", version: "1.0.0" });
    }
  });

  test("componente, repositório e stack do build", () => {
    const m = s["build-manifest"];
    expect(m.nodes.find((n) => n.key === PCA)?.props).toEqual({ name: "product-catalog-api", kind: "service" });
    expect(rel(m, "HOSTED_IN")[0].to).toBe("repo:gitlab.acmebank.example/acme/credito/product-catalog-api");
    const stack = Object.fromEntries(rel(m, "BUILT_WITH").map((r) => [r.to, r.props?.version]));
    expect(stack).toMatchObject({ "tech:java": "25", "tech:spring-boot": "4.1.0", "tech:service-platform": "1.2.0-SNAPSHOT" });
  });

  test("SBOM: diretas e transitivas, com a versão resolvida", () => {
    const deps = rel(s.sbom, "DEPENDS_ON");
    expect(deps.length).toBeGreaterThan(200);
    const starter = deps.find((r) => r.to === "lib:maven/org.acme.platform:platform-starter-http-api")!;
    expect(starter.props).toEqual({ version: "1.2.0-SNAPSHOT", scope: "runtime", resolved: true, direct: true });
    const web = deps.find((r) => r.to === "lib:maven/org.springframework:spring-web")!;
    expect(web.props).toMatchObject({ direct: false });
    // A transitiva diz por quais diretas chega; a direta não tem via.
    expect(web.props?.via).toContain("lib:maven/org.acme.platform:platform-starter-http-api");
    expect(starter.props?.via).toBeUndefined();
    expect(deps.filter((r) => r.props?.direct === false).every((r) => Array.isArray(r.props?.via) && r.props.via.length > 0)).toBe(true);
  });

  test("SBOM: via pela árvore, por qualquer caminho e só com as diretas", () => {
    const bom: CycloneDx = {
      metadata: { component: { "bom-ref": "root", name: "app" } },
      components: ["a", "b", "x", "y"].map((n) => ({ "bom-ref": n, type: "library", name: n, version: "1.0.0", purl: `pkg:maven/g/${n}@1.0.0` })),
      dependencies: [
        { ref: "root", dependsOn: ["a", "b"] },
        { ref: "a", dependsOn: ["x"] },
        { ref: "b", dependsOn: ["x", "a"] },
        { ref: "x", dependsOn: ["y"] },
      ],
    };
    const via = bringers(dependencyTree(bom));
    expect(via.get("lib:maven/g:x")).toEqual(["lib:maven/g:a", "lib:maven/g:b"]);
    expect(via.get("lib:maven/g:y")).toEqual(["lib:maven/g:a", "lib:maven/g:b"]);
    expect(via.has("lib:maven/g:a")).toBe(false); // direta, mesmo que b também a traga
  });

  test("uso: starter conta como usado pelo que ele traz; lib usada sem declarar aparece", () => {
    const usage = Object.fromEntries(rel(s["dependency-usage"], "DEPENDS_ON").map((r) => [r.to, r.props]));
    expect(usage["lib:maven/org.acme.platform:platform-starter-http-api"]).toEqual({ declared: true, used: true, scope: "implementation" });
    expect(usage["lib:maven/org.springframework:spring-web"]).toEqual({ declared: false, used: true });
    expect(usage["lib:maven/org.acme.platform:platform-bom"]).toBeUndefined(); // BOM (platform) não é dependência de código
  });

  test("OpenAPI: API, operações sem nome de parâmetro na chave e o contrato", () => {
    const o = s.openapi;
    expect(rel(o, "PROVIDES")).toEqual([{ type: "PROVIDES", from: PCA, to: "api:product-catalog/http", props: {}, evidence: "build/architecture/openapi.json" }]);
    expect(rel(o, "HAS_ENDPOINT").map((r) => r.to).sort()).toEqual(
      ["DELETE /products/{}", "GET /products", "GET /products/{}", "POST /products"].map((e) => `endpoint:product-catalog/${e}`),
    );
    const one = o.nodes.find((n) => n.key === "endpoint:product-catalog/GET /products/{}")!;
    expect(one.props).toMatchObject({ method: "GET", path: "/products/{id}", name: "GET /products/{id}", operationId: "getProduct" });
    expect(one.evidence).toBe("build/architecture/openapi.json#/paths/~1products~1{id}/get");
    expect(rel(o, "SPECIFIED_BY")[0].to).toBe("contract:openapi/product-catalog");
  });

  test("AsyncAPI: publica no tópico do catálogo", () => {
    const a = s.asyncapi;
    expect(rel(a, "PUBLISHES").map((r) => r.to)).toEqual(["topic:credit.product-catalog.product-created"]);
    expect(rel(a, "SUBSCRIBES")).toEqual([]);
    expect(rel(a, "SPECIFIED_BY")[0]).toMatchObject({ from: "topic:credit.product-catalog.product-created", to: "contract:asyncapi/product-catalog" });
  });

  test("dados: coleções mapeadas com dono, leitura e escrita com a linha do código", () => {
    const d = s["data-access"];
    const products = "dataset:acme/credito/product-catalog-api/products";
    const sequences = "dataset:acme/credito/product-catalog-api/sequences";
    expect(d.nodes.map((n) => n.key).sort()).toEqual([products, sequences]);
    expect(d.nodes.find((n) => n.key === products)!.props).toEqual({ name: "products", kind: "collection", store: "document" });
    expect(rel(d, "OWNS_DATA").map((r) => r.to).sort()).toEqual([products, sequences]);
    expect(rel(d, "OWNS_DATA", products)[0].evidence).toBe(
      "src/main/java/org/acme/credit/productcatalog/product/out/persistence/entity/ProductDocument.java",
    );
    expect(rel(d, "READS").map((r) => r.to).sort()).toEqual([products, sequences]);
    expect(rel(d, "WRITES").map((r) => r.to).sort()).toEqual([products, sequences]);
    expect(rel(d, "WRITES", products)[0].evidence).toMatch(/MongoProductRepository\.java#L\d+$/);
    expect(rel(d, "WRITES", sequences)[0].evidence).toMatch(/MongoProductCodeGenerator\.java#L\d+$/);
    expect(plan.warnings.filter((w) => w.startsWith("data-access"))).toEqual([]);
  });

  test("sem clientes HTTP: retrato vazio, para o que havia antes virar stale", () => {
    expect(s["http-clients"].relations).toEqual([]);
  });
});

describe("graph-publish sobre a loan-simulation-api", () => {
  const plan = planPublish(fixture("loan-simulation-api"), AT, { env: {} });
  const s = bySource(plan.snapshots);

  test("OpenAPI: o contrato de cada operação, com o corpo, as respostas e o fecho dos schemas", () => {
    const node = (k: string) => s.openapi.nodes.find((n) => n.key === `endpoint:loan-simulation-api/${k}`)!;
    expect(node("POST /simulations").props).toMatchObject({ name: "POST /simulations", operationId: "createSimulation" });
    const create = JSON.parse(node("POST /simulations").props!.contract as string);
    expect(create.format).toBe("openapi-3");
    expect(create.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/CreateSimulationRequest");
    expect(Object.keys(create.responses).sort()).toEqual(["201", "400", "404", "422"]);
    expect(Object.keys(create.components.schemas).sort()).toEqual([
      "CreateSimulationRequest",
      "InstallmentResponse",
      "PricingSnapshotResponse",
      "ProblemDetail",
      "ProductSnapshotResponse",
      "SimulationResponse",
      "TotalsResponse",
    ]);
    const get = JSON.parse(node("GET /simulations/{}").props!.contract as string);
    expect(get.parameters).toEqual([expect.objectContaining({ name: "id", in: "path", required: true })]);
    expect(get.requestBody).toBeUndefined();
  });

  test("cliente HTTP: consome a API do catálogo e chama a operação, com o código como evidência", () => {
    const c = s["http-clients"];
    expect(rel(c, "CONSUMES")).toEqual([
      {
        type: "CONSUMES",
        from: LSA,
        to: "api:product-catalog/http",
        props: {},
        evidence: "src/main/java/org/acme/credit/loansimulationapi/simulation/out/integration/catalog/CatalogApi.java",
      },
    ]);
    expect(rel(c, "CALLS").map((r) => [r.to, r.evidence])).toEqual([
      [
        "endpoint:product-catalog/GET /products/{}",
        "src/main/java/org/acme/credit/loansimulationapi/simulation/out/integration/catalog/CatalogApi.java#getProduct",
      ],
    ]);
  });

  test("cliente HTTP sem source: a evidência é o ponto do artefato, sem deduzir o arquivo do tipo", () => {
    const doc = {
      clients: [{ group: "pricing", type: "com.example.PricingClient", operations: [{ method: "GET", path: "/rates", function: "rates" }] }],
    };
    const snap = mapHttpClients(createContext(plan.identity), doc).build(AT);
    expect(rel(snap, "CONSUMES")[0].evidence).toEndWith("http-clients.json#/clients/0");
    expect(rel(snap, "CALLS")[0].evidence).toEndWith("http-clients.json#/clients/0/operations/0");
  });

  test("cliente de API versionada no host: a API daquela versão do serviço", () => {
    const doc = {
      clients: [{ group: "product-catalog-v1", service: "product-catalog", version: "1", operations: [{ method: "GET", path: "/products/{id}" }] }],
    };
    const snap = mapHttpClients(createContext(plan.identity), doc).build(AT);
    expect(rel(snap, "CONSUMES").map((r) => r.to)).toEqual(["api:product-catalog/v1/http"]);
    expect(rel(snap, "CALLS").map((r) => r.to)).toEqual(["endpoint:product-catalog/GET /products/{}"]); // o host não muda a operação do código
  });

  test("pact: consome, especifica e chama, casando o caminho concreto com o cliente", () => {
    const p = s.pact;
    expect(rel(p, "CONSUMES")[0].to).toBe("api:product-catalog/http");
    expect(rel(p, "SPECIFIED_BY")[0]).toMatchObject({ from: "api:product-catalog/http", to: "contract:pact/loan-simulation-api→product-catalog" });
    const calls = rel(p, "CALLS");
    expect(calls.map((r) => r.to)).toEqual(["endpoint:product-catalog/GET /products/{}"]); // duas interações, uma operação
    expect(calls[0].evidence).toBe("build/architecture/pacts/loan-simulation-api-product-catalog.json#/interactions/0");
    expect(plan.warnings).toEqual([]);
  });

  test("sem cliente HTTP que case, o pact fica só com o CONSUMES e avisa", () => {
    const pact = JSON.parse(readFileSync(join(fixture("loan-simulation-api"), "pacts/loan-simulation-api-product-catalog.json"), "utf8"));
    const b = mapPacts(createContext(plan.identity), [{ file: "p.json", pact }], new Map());
    const snap = b.build(AT);
    expect(rel(snap, "CONSUMES")).toHaveLength(1);
    expect(rel(snap, "CALLS")).toEqual([]);
    expect(b.warnings).toHaveLength(2);
  });

  test("dados: a coleção de simulações", () => {
    const d = s["data-access"];
    const simulations = "dataset:acme/credito/loan-simulation-api/simulations";
    expect(rel(d, "OWNS_DATA").map((r) => r.to)).toEqual([simulations]);
    expect(rel(d, "READS").map((r) => r.to)).toEqual([simulations]);
    expect(rel(d, "WRITES").map((r) => r.to)).toEqual([simulations]);
  });

  test("as variáveis do CI têm precedência sobre o manifesto", () => {
    const ci = planPublish(fixture("loan-simulation-api"), AT, {
      env: { CI_PROJECT_PATH: "grupo/outro", CI_SERVER_HOST: "gitlab.exemplo.com", CI_COMMIT_SHA: "abc123", CI_PROJECT_URL: "https://gitlab.exemplo.com/grupo/outro" },
    });
    expect(ci.identity).toMatchObject({ path: "grupo/outro", host: "gitlab.exemplo.com", commit: "abc123", service: "loan-simulation-api" });
    expect(ci.snapshots[0].evidenceBase).toBe("grupo/outro@abc123:");
  });
});

describe("pacotes que o build gera", () => {
  const ctx = createContext({ path: "example/platform/framework", host: "git.example.com", commit: "abc123", service: "framework" }, { kind: "library" });

  test("cada pacote do manifesto vira PRODUCES, com a versão do purl", () => {
    const b = mapManifest(ctx, {
      format: "panorama-graph-manifest/1",
      packages: [{ purl: "pkg:maven/org.example.framework/framework-web@2.1.0" }, { purl: "pkg:npm/%40example/ui@2.1.0" }],
    });
    const snap = b.build(AT);
    expect(snap.nodes.find((n) => n.key === "component:example/platform/framework")?.props).toEqual({ name: "framework", kind: "library" });
    expect(rel(snap, "PRODUCES").map((r) => [r.to, r.props])).toEqual([
      ["lib:maven/org.example.framework:framework-web", { version: "2.1.0" }],
      ["lib:npm/@example/ui", { version: "2.1.0" }],
    ]);
    expect(snap.nodes.find((n) => n.key === "lib:maven/org.example.framework:framework-web")?.props).toEqual({ name: "org.example.framework:framework-web" });
    expect(b.warnings).toEqual([]);
  });

  test("pacote sem purl válido fica de fora, com aviso; sem packages, nenhum PRODUCES", () => {
    const b = mapManifest(ctx, { format: "panorama-graph-manifest/1", packages: [{ purl: "org.example:lib" }] });
    expect(rel(b.build(AT), "PRODUCES")).toEqual([]);
    expect(b.warnings).toEqual(['build-manifest: pacote sem purl válido ({"purl":"org.example:lib"})']);
    expect(rel(s(), "PRODUCES")).toEqual([]);
  });

  const s = () => bySource(planPublish(fixture("product-catalog-api"), AT, { env: {} }).snapshots)["build-manifest"];
});

describe("data-access", () => {
  const ctx = createContext({ path: "acme/x/servico", host: "localhost", commit: "abc", service: "servico" } as never);

  test("dataset de biblioteca ou só citado não tem dono; o que não resolveu vira aviso", () => {
    const b = mapDataAccess(ctx, {
      datasets: [
        { name: "shared", store: "document", kind: "collection", declaredIn: "library" },
        { name: "audit_log", store: "document", kind: "collection", declaredIn: "none" },
      ],
      accesses: [
        { dataset: "shared", store: "document", operation: "read", source: "src/main/java/A.java", line: 10 },
        { dataset: "audit_log", store: "document", operation: "read-write", source: "src/main/java/B.java", line: 20 },
      ],
      unresolved: [{ reason: "nome da colecao em variavel", source: "src/main/java/C.java", line: 30 }],
    });
    const snap = b.build(AT);
    expect(rel(snap, "OWNS_DATA")).toEqual([]);
    expect(rel(snap, "READS").map((r) => r.to).sort()).toEqual(["dataset:acme/x/servico/audit_log", "dataset:acme/x/servico/shared"]);
    expect(rel(snap, "WRITES").map((r) => [r.to, r.evidence])).toEqual([["dataset:acme/x/servico/audit_log", "src/main/java/B.java#L20"]]);
    expect(b.warnings).toEqual(["data-access: nome da colecao em variavel (src/main/java/C.java#L30)"]);
  });
});

describe("contrato de operação (OpenAPI)", () => {
  test("Swagger 2: parâmetros do caminho, definitions como schemas e ciclos resolvidos", () => {
    const doc = {
      swagger: "2.0",
      paths: { "/a/{id}": { parameters: [{ $ref: "#/parameters/Id" }], get: { responses: { "200": { schema: { $ref: "#/definitions/Node" } } } } } },
      parameters: { Id: { name: "id", in: "path", required: true, type: "string" } },
      definitions: { Node: { type: "object", properties: { next: { $ref: "#/definitions/Node" } } } },
    };
    const c = operationContract(doc, doc.paths["/a/{id}"], doc.paths["/a/{id}"].get);
    expect(c).toMatchObject({ format: "swagger-2", parameters: [{ $ref: "#/parameters/Id" }] });
    const components = (c as { components: Record<string, Record<string, unknown>> }).components;
    expect(Object.keys(components.schemas)).toEqual(["Node"]);
    expect(Object.keys(components.parameters)).toEqual(["Id"]);
  });

  test("contrato grande vai sem o fecho, com aviso", () => {
    const big = { type: "string", description: "x".repeat(MAX_CONTRACT_CHARS) };
    const doc = { openapi: "3.1.0", paths: { "/x": { get: { responses: { "200": { content: { "*/*": { schema: { $ref: "#/components/schemas/Big" } } } } } } } }, components: { schemas: { Big: big } } };
    const ctx = createContext({ path: "g/x", host: "h", commit: "c", service: "x" } as never);
    const b = mapOpenApi(ctx, doc);
    const c = JSON.parse(b.build(AT).nodes.find((n) => n.type === "Endpoint")!.props!.contract as string);
    expect(c.components).toBeUndefined();
    expect(c.responses["200"]).toBeDefined();
    expect(b.warnings[0]).toContain("sem o fecho");
  });
});

describe("x-panorama-graph-source: evidência no código, para contrato gerado sem o build", () => {
  const ctx = createContext({ path: "g/orders", host: "h", commit: "c", service: "orders" } as never);
  const X = "x-panorama-graph-source";
  const ev = (snap: Snapshot, type: string) => rel(snap, type).map((r) => [r.to, r.evidence]);

  test("OpenAPI: API pela de info, operação pela dela ou pela do path item; contrato sempre no artefato", () => {
    const doc = {
      openapi: "3.1.0",
      info: { title: "orders", [X]: "src/main/java/g/OrdersApplication.java" },
      paths: {
        "/orders": { [X]: "src/main/java/g/OrderController.java", get: {}, post: { [X]: "src/main/java/g/OrderController.java#L30" } },
        "/health": { get: {} },
      },
    };
    const snap = mapOpenApi(ctx, doc).build(AT);
    expect(rel(snap, "PROVIDES")[0].evidence).toBe("src/main/java/g/OrdersApplication.java");
    expect(snap.nodes.find((n) => n.type === "Api")!.evidence).toBe("src/main/java/g/OrdersApplication.java");
    expect(ev(snap, "HAS_ENDPOINT")).toEqual([
      ["endpoint:orders/GET /orders", "src/main/java/g/OrderController.java"],
      ["endpoint:orders/POST /orders", "src/main/java/g/OrderController.java#L30"],
      ["endpoint:orders/GET /health", "build/architecture/openapi.json#/paths/~1health/get"],
    ]);
    expect(rel(snap, "SPECIFIED_BY")[0].evidence).toBe("build/architecture/openapi.json");
    const contract = JSON.parse(snap.nodes.find((n) => n.key === "endpoint:orders/POST /orders")!.props!.contract as string);
    expect(JSON.stringify(contract)).not.toContain(X);
  });

  test("valor que não é caminho no repositório é ignorado, com aviso uma vez só", () => {
    const doc = {
      openapi: "3.1.0",
      info: { [X]: "/home/dev/orders/App.java" },
      paths: { "/a": { [X]: "../fora.java", get: {}, put: {} }, "/b": { get: { [X]: "https://git/x.java" } }, "/c": { get: { [X]: 42 } } },
    };
    const b = mapOpenApi(ctx, doc);
    const snap = b.build(AT);
    expect(rel(snap, "PROVIDES")[0].evidence).toBe("build/architecture/openapi.json");
    expect(ev(snap, "HAS_ENDPOINT").map(([, e]) => e)).toEqual([
      "build/architecture/openapi.json#/paths/~1a/get",
      "build/architecture/openapi.json#/paths/~1a/put",
      "build/architecture/openapi.json#/paths/~1b/get",
      "build/architecture/openapi.json#/paths/~1c/get",
    ]);
    expect(b.warnings).toHaveLength(4);
    expect(b.warnings.every((w) => w.startsWith(`openapi: ${X} inválido`))).toBe(true);
  });

  test("AsyncAPI 3: tópico pela do canal, publicar e consumir pela da operação ou do canal", () => {
    const doc = {
      asyncapi: "3.0.0",
      channels: {
        created: { address: "orders.created", [X]: "src/main/java/g/Topics.java#L8" },
        paid: { address: "payments.paid" },
      },
      operations: {
        publishCreated: { action: "send" as const, channel: { $ref: "#/channels/created" }, [X]: "src/main/java/g/OrderEvents.java#L21" },
        onPaid: { action: "receive" as const, channel: { $ref: "#/channels/paid" }, [X]: "src/main/java/g/PaymentListener.java#onPaid" },
      },
    };
    const snap = mapAsyncApi(ctx, doc).build(AT);
    expect(ev(snap, "PUBLISHES")).toEqual([["topic:orders.created", "src/main/java/g/OrderEvents.java#L21"]]);
    expect(ev(snap, "SUBSCRIBES")).toEqual([["topic:payments.paid", "src/main/java/g/PaymentListener.java#onPaid"]]);
    expect(snap.nodes.find((n) => n.key === "topic:orders.created")!.evidence).toBe("src/main/java/g/Topics.java#L8");
    expect(snap.nodes.find((n) => n.key === "topic:payments.paid")!.evidence).toBe("build/architecture/asyncapi.json#/channels/paid");
    expect(rel(snap, "SPECIFIED_BY").every((r) => r.evidence === "build/architecture/asyncapi.json#/channels/" + (r.from === "topic:orders.created" ? "created" : "paid"))).toBe(true);
  });

  test("AsyncAPI 2: na operação do canal; sem ela, a do canal; sem nenhuma, o artefato", () => {
    const doc = {
      asyncapi: "2.6.0",
      channels: {
        "orders.created": { [X]: "src/orders/events.ts#publishCreated", subscribe: {} },
        "payments.paid": { publish: { [X]: "src/payments/listener.ts#L12" } },
        "stock.changed": { publish: {} },
      },
    };
    const snap = mapAsyncApi(ctx, doc).build(AT);
    expect(ev(snap, "PUBLISHES")).toEqual([["topic:orders.created", "src/orders/events.ts#publishCreated"]]);
    expect(ev(snap, "SUBSCRIBES")).toEqual([
      ["topic:payments.paid", "src/payments/listener.ts#L12"],
      ["topic:stock.changed", "build/architecture/asyncapi.json#/channels/stock.changed/publish"],
    ]);
  });
});

describe("versões de APIs e tópicos", () => {
  const ctx = (service: string) => createContext({ path: "g/orders", host: "h", commit: "c", service } as never);
  const nodes = (snap: Snapshot, type: string) => snap.nodes.filter((n) => n.type === type).map((n) => [n.key, n.props?.version]);

  test("OpenAPI versionado no código: uma API por versão do caminho; o que não tem versão fica na API sem versão", () => {
    const doc = { openapi: "3.1.0", info: { title: "Orders" }, paths: { "/v1/orders": { get: {} }, "/v2/orders/{id}": { get: {} }, "/health": { get: {} } } };
    const snap = mapOpenApi(ctx("orders"), doc).build(AT);
    expect(nodes(snap, "Api")).toEqual([
      ["api:orders/v1/http", "v1"],
      ["api:orders/v2/http", "v2"],
      ["api:orders/http", undefined],
    ]);
    expect(snap.nodes.find((n) => n.key === "api:orders/v2/http")!.props!.name).toBe("Orders v2");
    expect(rel(snap, "HAS_ENDPOINT").map((r) => [r.from, r.to])).toEqual([
      ["api:orders/v1/http", "endpoint:orders/v1/GET /v1/orders"],
      ["api:orders/v2/http", "endpoint:orders/v2/GET /v2/orders/{}"],
      ["api:orders/http", "endpoint:orders/GET /health"],
    ]);
    expect(rel(snap, "PROVIDES")).toHaveLength(3);
    expect(rel(snap, "SPECIFIED_BY").map((r) => r.to)).toEqual(Array(3).fill("contract:openapi/orders"));
  });

  test("OpenAPI: a versão declarada vence a do caminho; em info, vale para a API inteira", () => {
    const X = "x-panorama-graph-version";
    const doc = {
      openapi: "3.1.0",
      info: { title: "Orders", [X]: "3" },
      paths: { "/orders": { get: {}, post: { [X]: "v4" } }, "/items": { [X]: "bad", get: {} } },
    };
    const b = mapOpenApi(ctx("orders-v2"), doc); // o nome de serviço não é lido como versão
    const snap = b.build(AT);
    expect(nodes(snap, "Api")).toEqual([
      ["api:orders-v2/v3/http", "v3"],
      ["api:orders-v2/v4/http", "v4"],
    ]);
    expect(rel(snap, "HAS_ENDPOINT").map((r) => r.to)).toEqual([
      "endpoint:orders-v2/v3/GET /orders",
      "endpoint:orders-v2/v4/POST /orders",
      "endpoint:orders-v2/v3/GET /items",
    ]);
    expect(b.warnings).toEqual(['openapi: x-panorama-graph-version inválido em /items ("bad"); vale a versão da convenção']);
  });

  test("OpenAPI sem caminhos e sem versão: a API de sempre", () => {
    const snap = mapOpenApi(ctx("orders"), { openapi: "3.1.0", info: { title: "Orders" } }).build(AT);
    expect(nodes(snap, "Api")).toEqual([["api:orders/http", undefined]]);
  });

  test("cliente: a versão declarada na operação, quando o caminho não a traz", () => {
    const doc = { clients: [{ group: "payments", operations: [{ method: "GET", path: "/payments/{id}", version: "2" }] }] };
    const snap = mapHttpClients(ctx("orders"), doc).build(AT);
    expect(rel(snap, "CONSUMES").map((r) => r.to)).toEqual(["api:payments/v2/http"]);
    expect(rel(snap, "CALLS").map((r) => r.to)).toEqual(["endpoint:payments/v2/GET /payments/{}"]);
  });

  test("cliente: versão pelo group, sem service, e pelo caminho de cada operação", () => {
    const doc = {
      clients: [
        { group: "stock-v3", operations: [{ method: "GET", path: "/items" }] },
        { group: "payments", operations: [{ method: "POST", path: "/v1/payments" }, { method: "GET", path: "/v2/payments/{id}" }] },
      ],
    };
    const snap = mapHttpClients(ctx("orders"), doc).build(AT);
    expect(rel(snap, "CONSUMES").map((r) => r.to)).toEqual(["api:stock/v3/http", "api:payments/v1/http", "api:payments/v2/http"]);
    expect(rel(snap, "CALLS").map((r) => r.to)).toEqual([
      "endpoint:stock/GET /items",
      "endpoint:payments/v1/POST /v1/payments",
      "endpoint:payments/v2/GET /v2/payments/{}",
    ]);
  });

  test("pact: a versão pelo nome do provedor ou pelo caminho da interação, casando a operação da mesma versão", () => {
    const pact = (provider: string, path: string) => ({
      consumer: { name: "orders" },
      provider: { name: provider },
      interactions: [{ type: "Synchronous/HTTP", request: { method: "GET", path } }],
    });
    const clients = { clients: [{ group: "payments", operations: [{ method: "GET", path: "/v2/payments/{id}" }] }, { group: "stock-v3", operations: [{ method: "GET", path: "/items/{id}" }] }] };
    const ops = operationsByService(clients);
    const snap = mapPacts(ctx("orders"), [{ file: "a.json", pact: pact("payments", "/v2/payments/p-1") }, { file: "b.json", pact: pact("stock-v3", "/items/i-1") }], ops).build(AT);
    expect(rel(snap, "CONSUMES").map((r) => r.to)).toEqual(["api:payments/v2/http", "api:stock/v3/http"]);
    expect(rel(snap, "CALLS").map((r) => r.to)).toEqual(["endpoint:payments/v2/GET /v2/payments/{}", "endpoint:stock/GET /items/{}"]);

    const other = mapPacts(ctx("orders"), [{ file: "c.json", pact: pact("payments", "/v1/payments/p-1") }], ops);
    expect(rel(other.build(AT), "CALLS")).toEqual([]); // a v1 não é a operação conhecida da v2
    expect(other.warnings).toHaveLength(1);
  });

  test("AsyncAPI: a versão declarada no canal ou a do fim do nome do tópico", () => {
    const doc = {
      asyncapi: "3.0.0",
      channels: { a: { address: "orders.created.v2" }, b: { address: "orders-paid-v1" }, c: { address: "orders.cancelled", "x-panorama-graph-version": "v5" } },
      operations: {
        p: { action: "send" as const, channel: { $ref: "#/channels/a" } },
        q: { action: "send" as const, channel: { $ref: "#/channels/b" } },
        r: { action: "receive" as const, channel: { $ref: "#/channels/c" } },
      },
    };
    const snap = mapAsyncApi(ctx("orders"), doc).build(AT);
    expect(nodes(snap, "Topic")).toEqual([
      ["topic:orders.created.v2", "v2"],
      ["topic:orders-paid-v1", "v1"],
      ["topic:orders.cancelled", "v5"],
    ]);
  });
});
