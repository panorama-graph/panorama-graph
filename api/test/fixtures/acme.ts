/**
 * Um grafo pequeno no formato do ACME Bank, carregado como os adaptadores carregariam: um retrato por
 * fonte e escopo. Serve para testar as consultas contra as perguntas de validação do README da API.
 * O `service-config` da product-catalog-api usa o nome antigo (`component:product-catalog`), que vira
 * apelido antes da carga: o teste de apelido da pergunta 4.
 */

export const K = {
  domain: "domain:credito",
  sysCatalog: "system:credito/catalogo",
  sysSimulation: "system:credito/simulacao",
  dept: "group:credito",
  levelTribe: "level:tribo",
  levelTeam: "level:time",
  teamCatalog: "group:credito/time-catalogo",
  teamSimulation: "group:credito/time-simulacao",
  pca: "component:acme/credito/product-catalog-api",
  pcaOld: "component:product-catalog",
  lsa: "component:acme/credito/loan-simulation-api",
  web: "component:acme/credito/loan-simulation-web",
  job: "component:acme/credito/simulation-report-job",
  pcaApi: "api:product-catalog-api/http",
  lsaApi: "api:loan-simulation-api/http",
  epGetOne: "endpoint:product-catalog-api/GET /products/{id}",
  epList: "endpoint:product-catalog-api/GET /products",
  epCreate: "endpoint:product-catalog-api/POST /products",
  topic: "topic:credit.product-catalog.product-created",
  pact: "contract:pact/loan-simulation-api→product-catalog-api",
  openapi: "contract:openapi/product-catalog-api",
  asyncapi: "contract:asyncapi/credit.product-catalog.product-created",
  mongo: "resource:dev/mongodb",
  mongoDb: "resource:dev/mongodb/product-catalog",
  pg: "resource:dev/postgresql",
  pgDb: "resource:dev/postgresql/simulation",
  kafka: "resource:dev/kafka",
  ingress: "resource:dev/ingress-nginx",
  dev: "env:dev",
  springBoot: "tech:spring-boot",
  java: "tech:java",
  mongodb: "tech:mongodb",
  postgresql: "tech:postgresql",
  kafkaTech: "tech:kafka",
  platform: "lib:maven/br.com.acme:service-platform",
  products: "dataset:acme/credito/product-catalog-api/products",
  sequences: "dataset:acme/credito/product-catalog-api/sequences",
  ana: "person:ana",
  bruno: "person:bruno",
} as const;

export type Load = {
  source: string;
  scope?: Record<string, string>;
  evidenceBase: string;
  revision?: { component: string; commit: string; version?: string };
  producer?: { name: string; version: string };
  nodes?: { key: string; type: string; props?: Record<string, string | number | boolean>; evidence?: string }[];
  relations?: { type: string; from: string; to: string; props?: Record<string, string | boolean | string[]>; evidence?: string }[];
};

const comp = (key: string, name: string, kind: string) => ({ key, type: "Component", props: { name, kind } });

export const gitlab: Load = {
  source: "gitlab",
  evidenceBase: "https://gitlab.acmebank.example/",
  nodes: [
    { key: K.domain, type: "Domain", props: { name: "Crédito" }, evidence: "acme/credito" },
    { key: K.sysCatalog, type: "System", props: { name: "Catálogo" }, evidence: "acme/credito" },
    { key: K.sysSimulation, type: "System", props: { name: "Simulação" }, evidence: "acme/credito" },
    { ...comp(K.pca, "product-catalog-api", "service"), evidence: "acme/credito/product-catalog-api" },
    { ...comp(K.lsa, "loan-simulation-api", "service"), evidence: "acme/credito/loan-simulation-api" },
    { ...comp(K.web, "loan-simulation-web", "frontend"), evidence: "acme/credito/loan-simulation-web" },
    { ...comp(K.job, "simulation-report-job", "job"), evidence: "acme/credito/simulation-report-job" },
    { key: K.ana, type: "Person", props: { name: "Ana" }, evidence: "users/ana" },
    { key: K.bruno, type: "Person", props: { name: "Bruno" }, evidence: "users/bruno" },
  ],
  relations: [
    { type: "PART_OF", from: K.sysCatalog, to: K.domain, evidence: "acme/credito" },
    { type: "PART_OF", from: K.sysSimulation, to: K.domain, evidence: "acme/credito" },
    { type: "PART_OF", from: K.pca, to: K.sysCatalog, evidence: "acme/credito/product-catalog-api" },
    { type: "PART_OF", from: K.lsa, to: K.sysSimulation, evidence: "acme/credito/loan-simulation-api" },
    { type: "PART_OF", from: K.web, to: K.sysSimulation, evidence: "acme/credito/loan-simulation-web" },
    { type: "PART_OF", from: K.job, to: K.sysSimulation, evidence: "acme/credito/simulation-report-job" },
    { type: "HOSTED_IN", from: K.pca, to: "repo:gitlab/acme/credito/product-catalog-api", evidence: "acme/credito/product-catalog-api" },
    { type: "HOSTED_IN", from: K.lsa, to: "repo:gitlab/acme/credito/loan-simulation-api", evidence: "acme/credito/loan-simulation-api" },
    { type: "MEMBER_OF", from: K.ana, to: K.teamCatalog, props: { role: "maintainer" }, evidence: "acme/credito/-/members" },
    { type: "MEMBER_OF", from: K.bruno, to: K.teamSimulation, props: { role: "developer" }, evidence: "acme/credito/-/members" },
  ],
};

export const ownership: Load = {
  source: "ownership",
  evidenceBase: "https://wiki.acmebank.example/dominios-e-times#",
  nodes: [
    { key: K.levelTribe, type: "OrgLevel", props: { name: "Tribo", order: 1 }, evidence: "niveis" },
    { key: K.levelTeam, type: "OrgLevel", props: { name: "Time", order: 2, team: true }, evidence: "niveis" },
    { key: K.dept, type: "Group", props: { name: "Crédito" }, evidence: "credito" },
    { key: K.teamCatalog, type: "Group", props: { name: "Time Catálogo" }, evidence: "time-catalogo" },
    { key: K.teamSimulation, type: "Group", props: { name: "Time Simulação" }, evidence: "time-simulacao" },
  ],
  relations: [
    { type: "AT_LEVEL", from: K.dept, to: K.levelTribe, evidence: "credito" },
    { type: "AT_LEVEL", from: K.teamCatalog, to: K.levelTeam, evidence: "time-catalogo" },
    { type: "AT_LEVEL", from: K.teamSimulation, to: K.levelTeam, evidence: "time-simulacao" },
    { type: "PART_OF", from: K.teamCatalog, to: K.dept, evidence: "time-catalogo" },
    { type: "PART_OF", from: K.teamSimulation, to: K.dept, evidence: "time-simulacao" },
    { type: "OWNED_BY", from: K.domain, to: K.dept, evidence: "credito" },
    { type: "OWNED_BY", from: K.pca, to: K.teamCatalog, evidence: "time-catalogo" },
    { type: "OWNED_BY", from: K.lsa, to: K.teamSimulation, evidence: "time-simulacao" },
    { type: "OWNED_BY", from: K.web, to: K.teamSimulation, evidence: "time-simulacao" },
    { type: "OWNED_BY", from: K.job, to: K.teamSimulation, evidence: "time-simulacao" },
  ],
};

/** Contrato de `POST /products`, no formato que o adaptador de OpenAPI grava em `Endpoint.contract`. */
export const createProductContract = {
  format: "openapi-3",
  requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateProductRequest" } } } },
  responses: { "201": { description: "Produto criado", content: { "*/*": { schema: { $ref: "#/components/schemas/Product" } } } } },
  components: {
    schemas: {
      CreateProductRequest: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      Product: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
    },
  },
};

export const openapi: Load[] = [
  {
    source: "openapi",
    scope: { component: "product-catalog-api" },
    revision: { component: K.pca, commit: "a1b2c3d", version: "1.1.0" },
    evidenceBase: "https://product-catalog-api.dev.acmebank.example/v3/api-docs",
    nodes: [
      { key: K.pcaApi, type: "Api", props: { kind: "http" } },
      { key: K.epGetOne, type: "Endpoint", props: { method: "GET", path: "/products/{id}" }, evidence: "#/paths/~1products~1{id}/get" },
      { key: K.epList, type: "Endpoint", props: { method: "GET", path: "/products" }, evidence: "#/paths/~1products/get" },
      {
        key: K.epCreate,
        type: "Endpoint",
        props: { method: "POST", path: "/products", operationId: "createProduct", contract: JSON.stringify(createProductContract) },
        evidence: "#/paths/~1products/post",
      },
      { key: K.openapi, type: "Contract", props: { kind: "openapi" } },
    ],
    relations: [
      { type: "PROVIDES", from: K.pca, to: K.pcaApi },
      { type: "HAS_ENDPOINT", from: K.pcaApi, to: K.epGetOne, evidence: "#/paths/~1products~1{id}/get" },
      { type: "HAS_ENDPOINT", from: K.pcaApi, to: K.epList, evidence: "#/paths/~1products/get" },
      { type: "HAS_ENDPOINT", from: K.pcaApi, to: K.epCreate, evidence: "#/paths/~1products/post" },
      { type: "SPECIFIED_BY", from: K.pcaApi, to: K.openapi },
    ],
  },
  {
    source: "openapi",
    scope: { component: "loan-simulation-api" },
    evidenceBase: "https://loan-simulation-api.dev.acmebank.example/v3/api-docs",
    nodes: [{ key: K.lsaApi, type: "Api", props: { kind: "http" } }],
    relations: [{ type: "PROVIDES", from: K.lsa, to: K.lsaApi }],
  },
];

export const pact: Load = {
  source: "pact-broker",
  scope: { participant: "loan-simulation-api" },
  evidenceBase: "https://pact-broker.acmebank.example/pacts/provider/product-catalog-api/consumer/loan-simulation-api/latest",
  nodes: [{ key: K.pact, type: "Contract", props: { kind: "pact" } }],
  relations: [
    { type: "CONSUMES", from: K.lsa, to: K.pcaApi },
    { type: "CALLS", from: K.lsa, to: K.epGetOne, evidence: "#interaction-1" },
    { type: "CALLS", from: K.lsa, to: K.epList, evidence: "#interaction-2" },
    { type: "SPECIFIED_BY", from: K.pcaApi, to: K.pact },
  ],
};

export const serviceConfig: Load[] = [
  {
    source: "service-config",
    scope: { component: "product-catalog-api" },
    evidenceBase: "product-catalog-api@a1b2c3d:src/main/resources/application.yaml:",
    nodes: [
      { key: K.mongoDb, type: "Resource", props: { kind: "database" }, evidence: "12" },
      { key: K.topic, type: "Topic", props: { kind: "topic" }, evidence: "30" },
    ],
    relations: [
      { type: "USES_RESOURCE", from: K.pcaOld, to: K.mongoDb, props: { access: "read-write" }, evidence: "12" },
      { type: "HOSTED_ON", from: K.mongoDb, to: K.mongo, evidence: "12" },
      { type: "PUBLISHES", from: K.pcaOld, to: K.topic, evidence: "30" },
      { type: "HOSTED_ON", from: K.topic, to: K.kafka, evidence: "28" },
    ],
  },
  {
    source: "service-config",
    scope: { component: "loan-simulation-api" },
    evidenceBase: "loan-simulation-api@d4e5f6a:",
    nodes: [{ key: K.pgDb, type: "Resource", props: { kind: "database" }, evidence: "src/main/resources/application.yaml:8" }],
    relations: [
      { type: "CONSUMES", from: K.lsa, to: K.pcaApi, evidence: "helm/values-dev.yaml:22" },
      { type: "USES_RESOURCE", from: K.lsa, to: K.pgDb, props: { access: "read-write" }, evidence: "src/main/resources/application.yaml:8" },
      { type: "HOSTED_ON", from: K.pgDb, to: K.pg, evidence: "src/main/resources/application.yaml:8" },
      { type: "SUBSCRIBES", from: K.lsa, to: K.topic, evidence: "src/main/resources/application.yaml:40" },
      { type: "REACHES_VIA", from: K.lsa, to: K.ingress, evidence: "helm/values-dev.yaml:22" },
    ],
  },
  {
    source: "service-config",
    scope: { component: "loan-simulation-web" },
    evidenceBase: "loan-simulation-web@0a1b2c3:",
    relations: [{ type: "CONSUMES", from: K.web, to: K.lsaApi, evidence: "helm/values-dev.yaml:10" }],
  },
  {
    source: "service-config",
    scope: { component: "simulation-report-job" },
    evidenceBase: "simulation-report-job@9f8e7d6:",
    relations: [{ type: "USES_RESOURCE", from: K.job, to: K.pgDb, props: { access: "read" }, evidence: "application.yaml:5" }],
  },
];

export const k8sInfra: Load = {
  source: "k8s-infra",
  scope: { cluster: "dev" },
  evidenceBase: "k8s://dev/",
  nodes: [
    { key: K.mongo, type: "Resource", props: { kind: "database-server" }, evidence: "infra/statefulset/mongodb" },
    { key: K.pg, type: "Resource", props: { kind: "database-server" }, evidence: "infra/statefulset/postgresql" },
    { key: K.kafka, type: "Resource", props: { kind: "broker" }, evidence: "infra/statefulset/kafka" },
    { key: K.dev, type: "Environment", props: { name: "dev", kind: "development" }, evidence: "cluster" },
  ],
  relations: [
    { type: "IN_ENVIRONMENT", from: K.mongo, to: K.dev, evidence: "infra/statefulset/mongodb" },
    { type: "IN_ENVIRONMENT", from: K.pg, to: K.dev, evidence: "infra/statefulset/postgresql" },
    { type: "IN_ENVIRONMENT", from: K.kafka, to: K.dev, evidence: "infra/statefulset/kafka" },
    { type: "RUNS", from: K.mongo, to: K.mongodb, props: { version: "7.0.5" }, evidence: "infra/statefulset/mongodb" },
    { type: "RUNS", from: K.pg, to: K.postgresql, props: { version: "16.2" }, evidence: "infra/statefulset/postgresql" },
    { type: "RUNS", from: K.kafka, to: K.kafkaTech, props: { version: "3.7.0" }, evidence: "infra/statefulset/kafka" },
  ],
};

export const k8sRoutes: Load = {
  source: "k8s-routes",
  scope: { cluster: "dev" },
  evidenceBase: "k8s://dev/",
  nodes: [{ key: K.ingress, type: "Resource", props: { kind: "ingress" }, evidence: "ingress-nginx/controller" }],
  relations: [
    { type: "IN_ENVIRONMENT", from: K.ingress, to: K.dev, evidence: "ingress-nginx/controller" },
    { type: "ROUTES", from: K.ingress, to: K.pca, props: { host: "product-catalog-api.dev.acmebank.example", path: "/" }, evidence: "credito/ingress/product-catalog-api" },
    { type: "ROUTES", from: K.ingress, to: K.lsa, props: { host: "loan-simulation-api.dev.acmebank.example", path: "/" }, evidence: "credito/ingress/loan-simulation-api" },
    { type: "ROUTES", from: K.ingress, to: K.pca, props: { host: "api.dev.acmebank.example", path: "/catalog" }, evidence: "credito/ingress/api" },
    { type: "ROUTES", from: K.ingress, to: K.lsa, props: { host: "api.dev.acmebank.example", path: "/catalog/simulation" }, evidence: "credito/ingress/api" },
  ],
};

const sbomOf = (component: string, key: string, sha: string, springBoot: string, platform: string): Load => ({
  source: "sbom",
  scope: { component },
  revision: { component: key, commit: sha },
  evidenceBase: `${component}@${sha}:target/bom.json#`,
  nodes: [{ key: K.platform, type: "Library", props: { name: "service-platform" } }],
  relations: [
    { type: "BUILT_WITH", from: key, to: K.springBoot, props: { version: springBoot } },
    { type: "BUILT_WITH", from: key, to: K.java, props: { version: "21" } },
    { type: "DEPENDS_ON", from: key, to: K.platform, props: { version: platform, scope: "compile", resolved: true, direct: true } },
    { type: "DEPENDS_ON", from: key, to: "lib:maven/org.mongodb:mongodb-driver-sync", props: { version: "4.11.1", scope: "compile", resolved: true, direct: false, via: [K.platform] } },
  ],
});

/** Declarado × usado (dependency-analysis): segunda fonte da mesma relação DEPENDS_ON. */
export const dependencyUsage: Load = {
  source: "dependency-usage",
  scope: { component: "product-catalog-api" },
  evidenceBase: "product-catalog-api@a1b2c3d:build/architecture/dependency-usage/",
  relations: [
    { type: "DEPENDS_ON", from: K.pca, to: K.platform, props: { declared: true, used: true, configurations: ["implementation"] }, evidence: "declarations.json" },
    { type: "DEPENDS_ON", from: K.pca, to: "lib:maven/org.mongodb:mongodb-driver-sync", props: { declared: false, used: true }, evidence: "usages-dependencies.json" },
  ],
};

/** Datasets e acessos lidos do bytecode pelo plugin (data-access.json). */
export const dataAccess: Load = {
  source: "data-access",
  scope: { component: "acme/credito/product-catalog-api" },
  evidenceBase: "acme/credito/product-catalog-api@a1b2c3d:",
  nodes: [
    { key: K.products, type: "Dataset", props: { name: "products", kind: "collection", store: "document" }, evidence: "src/main/java/org/acme/ProductDocument.java" },
    { key: K.sequences, type: "Dataset", props: { name: "sequences", kind: "collection", store: "document" }, evidence: "src/main/java/org/acme/ProductCodeSequenceDocument.java" },
  ],
  relations: [
    { type: "OWNS_DATA", from: K.pca, to: K.products, evidence: "src/main/java/org/acme/ProductDocument.java" },
    { type: "OWNS_DATA", from: K.pca, to: K.sequences, evidence: "src/main/java/org/acme/ProductCodeSequenceDocument.java" },
    { type: "READS", from: K.pca, to: K.products, evidence: "src/main/java/org/acme/MongoProductRepository.java#L31" },
    { type: "WRITES", from: K.pca, to: K.products, evidence: "src/main/java/org/acme/MongoProductRepository.java#L25" },
    { type: "READS", from: K.pca, to: K.sequences, evidence: "src/main/java/org/acme/MongoProductCodeGenerator.java#L22" },
    { type: "WRITES", from: K.pca, to: K.sequences, evidence: "src/main/java/org/acme/MongoProductCodeGenerator.java#L22" },
  ],
};

export const sbom: Load[] = [
  sbomOf("product-catalog-api", K.pca, "a1b2c3d", "3.2.4", "2.3.1"),
  sbomOf("loan-simulation-api", K.lsa, "d4e5f6a", "3.3.0", "3.0.0-RC1"),
];

/** Implantações lidas do cluster: os dois serviços em dev, no commit da linha principal. */
export const deployments: Load = {
  source: "k8s-deployments",
  scope: { cluster: "acme", namespace: "dev" },
  evidenceBase: "k8s://acme/dev/",
  relations: [
    {
      type: "DEPLOYED_IN",
      from: K.pca,
      to: K.dev,
      props: { version: "1.1.0", commit: "a1b2c3d", image: "registry/product-catalog-api:1.1.0", replicas: "2" },
      evidence: "deployment/product-catalog-api",
    },
    { type: "DEPLOYED_IN", from: K.lsa, to: K.dev, props: { version: "2.0.0", commit: "d4e5f6a" }, evidence: "deployment/loan-simulation-api" },
  ],
};

/** Ordem das cargas. O apelido do nome antigo entra antes do service-config. */
export const ACME_LOADS: (Load | { alias: { key: string; alias: string } })[] = [
  gitlab,
  ownership,
  ...openapi,
  pact,
  k8sInfra,
  k8sRoutes,
  { alias: { key: K.pca, alias: K.pcaOld } },
  ...serviceConfig,
  ...sbom,
  dependencyUsage,
  dataAccess,
  deployments,
];

type Poster = (method: "POST", url: string, payload: unknown) => Promise<{ statusCode: number; body: string }>;

/** Carrega o grafo pelo REST. `post` pode ser app.inject (testes) ou fetch (banco de desenvolvimento). */
export async function loadAcme(post: Poster, start = Date.UTC(2026, 8, 29, 9, 0, 0)): Promise<void> {
  let t = start;
  for (const step of ACME_LOADS) {
    const res =
      "alias" in step
        ? await post("POST", `/v1/nodes/${encodeURIComponent(step.alias.key)}/aliases`, { alias: step.alias.alias, reason: "nome antigo" })
        : await post("POST", "/v1/ingest", { ...step, observedAt: new Date((t += 1000)).toISOString() });
    if (res.statusCode >= 300) throw new Error(`carga do ACME Bank falhou (${res.statusCode}): ${res.body}`);
  }
}
