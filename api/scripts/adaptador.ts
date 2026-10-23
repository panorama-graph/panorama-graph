/**
 * O catálogo de relações do ADAPTADOR.md: para cada tipo de relação do modelo, quem costuma afirmá-la, o que vai
 * junto e um retrato de exemplo, gerado entre os marcadores `<!-- relacoes:inicio -->` e `<!-- relacoes:fim -->`.
 *
 *   pnpm run adaptador:write   regrava o catálogo
 *
 * O teste `adaptador-doc.test.ts` falha quando o documento fica para trás, quando um tipo ou par de relação do
 * modelo não tem exemplo e quando um exemplo não passa na validação do POST /v1/ingest.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IngestBody } from "../src/ingest/payload";
import { RELATION_TYPE_NAMES, relationSpec, type RelationType } from "../src/model/model";

export const ADAPTADOR_PATH = join(import.meta.dirname, "..", "ADAPTADOR.md");
const START = "<!-- relacoes:inicio -->";
const END = "<!-- relacoes:fim -->";

export const OBSERVED_AT = "2026-10-01T12:00:00Z";

type Fact = { evidence: string; props?: Record<string, string | number | boolean | string[]> };
type NodeExample = Fact & { key: string; type: string };
type RelationExample = Fact & { type: RelationType; from: string; to: string };

export type RelationGuide = {
  /** Quem costuma afirmar a relação, e com que fonte e escopo. */
  who: string;
  /** O que vai junto e o que costuma dar errado. */
  notes: string[];
  source: string;
  scope: Record<string, string>;
  evidenceBase?: string;
  nodes?: NodeExample[];
  relations: RelationExample[];
};

const PRODUCT = "component:example/catalog/product-api";
const CHECKOUT = "component:example/checkout/checkout-api";
const PRODUCT_SCOPE = { component: "example/catalog/product-api" };
const CHECKOUT_SCOPE = { component: "example/checkout/checkout-api" };
const ENV_SCOPE = { cluster: "example", namespace: "catalog-dev" };
const PRODUCT_AT = "example/catalog/product-api@4f2a9c1:";
const CHECKOUT_AT = "example/checkout/checkout-api@9b1e0d7:";

export const RELATION_GUIDE: Record<RelationType, RelationGuide> = {
  PART_OF: {
    who: "O catálogo de serviços (domínios, sistemas e componentes, fonte `service-catalog`) e o diretório da empresa (a árvore de grupos, fonte `directory`). São fontes diferentes, em retratos diferentes.",
    notes: [
      "`Group PART_OF Group` é a hierarquia da organização: o filho aponta para o pai, no retrato do diretório, com o nível de cada grupo (veja o exemplo de `AT_LEVEL`).",
      "Um componente pertence a um sistema só; dois `PART_OF` do mesmo componente na mesma fonte são dois sistemas, e as consultas mostram os dois.",
    ],
    source: "service-catalog",
    scope: { catalog: "example" },
    evidenceBase: "https://catalog.example.com/",
    nodes: [
      { key: "domain:catalog", type: "Domain", props: { name: "Catálogo" }, evidence: "domains/catalog" },
      { key: "system:catalog/products", type: "System", props: { name: "Produtos" }, evidence: "systems/catalog-products" },
      { key: PRODUCT, type: "Component", props: { name: "product-api", kind: "service" }, evidence: "components/product-api" },
    ],
    relations: [
      { type: "PART_OF", from: "system:catalog/products", to: "domain:catalog", evidence: "systems/catalog-products" },
      { type: "PART_OF", from: PRODUCT, to: "system:catalog/products", evidence: "components/product-api" },
    ],
  },
  OWNED_BY: {
    who: "O catálogo de serviços (fonte `service-catalog`).",
    notes: [
      "O dono é um grupo, normalmente um time (o grupo num nível com `team: true`). As consultas sobem a árvore de grupos a partir dele.",
      "`Api OWNED_BY` só quando a API tem dono diferente do componente que a oferece; sem ela, o dono da API é o do componente.",
    ],
    source: "service-catalog",
    scope: { catalog: "example" },
    evidenceBase: "https://catalog.example.com/",
    relations: [
      { type: "OWNED_BY", from: "domain:catalog", to: "group:digital-products", evidence: "domains/catalog" },
      { type: "OWNED_BY", from: "system:catalog/products", to: "group:catalog-team", evidence: "systems/catalog-products" },
      { type: "OWNED_BY", from: PRODUCT, to: "group:catalog-team", evidence: "components/product-api" },
      { type: "OWNED_BY", from: "api:product-api/http", to: "group:catalog-team", evidence: "apis/product-api" },
    ],
  },
  MEMBER_OF: {
    who: "O diretório da empresa (fonte `directory`, um retrato com todas as pessoas).",
    notes: [
      "A chave da pessoa é o login no diretório (`person:<login>`): é por ela que o resto da organização a encontra.",
      "`lead: true` marca quem lidera o grupo; `role` é texto livre, no vocabulário da organização.",
    ],
    source: "directory",
    scope: { tenant: "example" },
    evidenceBase: "https://directory.example.com/",
    nodes: [{ key: "person:maria.silva", type: "Person", props: { name: "Maria Silva", email: "maria.silva@example.com" }, evidence: "users/maria.silva" }],
    relations: [
      { type: "MEMBER_OF", from: "person:maria.silva", to: "group:catalog-team", props: { role: "Tech Lead", lead: true }, evidence: "users/maria.silva" },
    ],
  },
  AT_LEVEL: {
    who: "O diretório da empresa (fonte `directory`), no mesmo retrato dos grupos.",
    notes: [
      "Os níveis são nós com o nome que a organização usa. `order` é a posição de cima para baixo (1 é o topo) e `team: true` marca os níveis cujos grupos são times.",
      "A hierarquia é a do `PART_OF` entre grupos, nunca a do `order`: um time pode ficar direto sob a diretoria.",
    ],
    source: "directory",
    scope: { tenant: "example" },
    evidenceBase: "https://directory.example.com/",
    nodes: [
      { key: "level:diretoria", type: "OrgLevel", props: { name: "Diretoria", order: 1 }, evidence: "levels/diretoria" },
      { key: "level:time", type: "OrgLevel", props: { name: "Time", order: 2, team: true }, evidence: "levels/time" },
      { key: "group:digital-products", type: "Group", props: { name: "Produtos Digitais" }, evidence: "groups/digital-products" },
      { key: "group:catalog-team", type: "Group", props: { name: "Time de Catálogo" }, evidence: "groups/catalog-team" },
    ],
    relations: [
      { type: "AT_LEVEL", from: "group:digital-products", to: "level:diretoria", evidence: "groups/digital-products" },
      { type: "AT_LEVEL", from: "group:catalog-team", to: "level:time", evidence: "groups/catalog-team" },
      { type: "PART_OF", from: "group:catalog-team", to: "group:digital-products", evidence: "groups/catalog-team" },
    ],
  },
  HOSTED_IN: {
    who: "O build de cada componente (fonte `build-manifest`, escopo `{component}`) ou o catálogo, para componentes que não publicam build.",
    notes: ["A chave do componente é o caminho do repositório, e a do repositório leva o host: `repo:<host>/<caminho>`."],
    source: "build-manifest",
    scope: PRODUCT_SCOPE,
    nodes: [
      { key: "repo:git.example.com/example/catalog/product-api", type: "Repository", props: { url: "https://git.example.com/example/catalog/product-api" }, evidence: `${PRODUCT_AT}build/architecture/manifest.json` },
    ],
    relations: [
      { type: "HOSTED_IN", from: PRODUCT, to: "repo:git.example.com/example/catalog/product-api", evidence: `${PRODUCT_AT}build/architecture/manifest.json` },
    ],
  },
  PROVIDES: {
    who: "O contrato que o próprio componente gera (fonte `openapi`, escopo `{component}`) e, para a versão exposta na infraestrutura, quem lê a implantação (veja `VERSION_OF`).",
    notes: [
      "A API é nomeada pelo **nome de serviço**, o nome com que os clientes conhecem o componente (o participante nos pacts), e não pelo caminho do repositório: `api:product-api/http`. É assim que provedor e consumidores chegam à mesma chave.",
      "Vem no mesmo retrato que os endpoints (`HAS_ENDPOINT`) e o contrato (`SPECIFIED_BY`).",
    ],
    source: "openapi",
    scope: PRODUCT_SCOPE,
    evidenceBase: PRODUCT_AT,
    nodes: [{ key: "api:product-api/http", type: "Api", props: { name: "Product API", kind: "http" }, evidence: "src/main/java/com/example/catalog/ProductController.java" }],
    relations: [{ type: "PROVIDES", from: PRODUCT, to: "api:product-api/http", evidence: "src/main/java/com/example/catalog/ProductController.java" }],
  },
  HAS_ENDPOINT: {
    who: "O contrato da API (fonte `openapi`), no retrato do `PROVIDES`.",
    notes: [
      "A chave do endpoint leva o caminho com os parâmetros anônimos (`/products/{}`); o caminho original, com os nomes, vai na propriedade `path`.",
      "`contract` é opcional: o JSON da operação (parâmetros, corpo, respostas e os `$ref` locais em `components`), lido pelo `contract_get`.",
    ],
    source: "openapi",
    scope: PRODUCT_SCOPE,
    evidenceBase: PRODUCT_AT,
    nodes: [
      {
        key: "endpoint:product-api/GET /products/{}",
        type: "Endpoint",
        props: { name: "GET /products/{id}", method: "GET", path: "/products/{id}", operationId: "getProduct" },
        evidence: "src/main/java/com/example/catalog/ProductController.java#getProduct",
      },
    ],
    relations: [
      { type: "HAS_ENDPOINT", from: "api:product-api/http", to: "endpoint:product-api/GET /products/{}", evidence: "src/main/java/com/example/catalog/ProductController.java#getProduct" },
    ],
  },
  CONSUMES: {
    who: "O consumidor: os clientes HTTP declarados no código (fonte `http-clients`) e os pacts (fonte `pact`), cada um no escopo `{component}` do consumidor.",
    notes: [
      "Afirme `CONSUMES` sempre que afirmar `CALLS`: as perguntas de dependência (`component_dependencies`, `architecture_overview`) andam por `CONSUMES`, e `CALLS` diz quais operações.",
      "O consumidor de uma versão exposta na infraestrutura (`product-api-v2.example.com`) consome a API daquela versão, `api:product-api/v2/http`.",
    ],
    source: "http-clients",
    scope: CHECKOUT_SCOPE,
    evidenceBase: CHECKOUT_AT,
    relations: [{ type: "CONSUMES", from: CHECKOUT, to: "api:product-api/http", evidence: "src/main/java/com/example/checkout/catalog/CatalogClient.java" }],
  },
  CALLS: {
    who: "O consumidor, no retrato do `CONSUMES` (fontes `http-clients` e `pact`).",
    notes: [
      "O endpoint chamado tem a chave do provedor: o nome de serviço do provedor, o método e o caminho com os parâmetros anônimos. O consumidor não precisa saber como o provedor nomeia os parâmetros.",
      "Numa API versionada na infraestrutura, o cliente chama os endpoints do código, sem a versão do host (`endpoint:product-api/GET /products/{}`).",
    ],
    source: "http-clients",
    scope: CHECKOUT_SCOPE,
    evidenceBase: CHECKOUT_AT,
    relations: [
      { type: "CONSUMES", from: CHECKOUT, to: "api:product-api/http", evidence: "src/main/java/com/example/checkout/catalog/CatalogClient.java" },
      { type: "CALLS", from: CHECKOUT, to: "endpoint:product-api/GET /products/{}", evidence: "src/main/java/com/example/checkout/catalog/CatalogClient.java#getProduct" },
    ],
  },
  PUBLISHES: {
    who: "O contrato de eventos do componente (fonte `asyncapi`, escopo `{component}`).",
    notes: [
      "O tópico é identificado pelo endereço no broker; a versão, quando há, já está no nome (`catalog.product-created.v1`) e vai também em `version`.",
      "Quem publica e quem assina chegam ao mesmo nó pela mesma chave, sem combinar nada além do endereço.",
    ],
    source: "asyncapi",
    scope: PRODUCT_SCOPE,
    evidenceBase: PRODUCT_AT,
    nodes: [{ key: "topic:catalog.product-created.v1", type: "Topic", props: { name: "catalog.product-created.v1", kind: "topic", version: "v1" }, evidence: "build/architecture/asyncapi.json#/channels/productCreated" }],
    relations: [{ type: "PUBLISHES", from: PRODUCT, to: "topic:catalog.product-created.v1", evidence: "src/main/java/com/example/catalog/ProductEvents.java#publishCreated" }],
  },
  SUBSCRIBES: {
    who: "O contrato de eventos do consumidor (fonte `asyncapi`, escopo `{component}` dele).",
    notes: ["Uma fila (`kind: queue`) é um `Topic` também: quem lê dela assina com `SUBSCRIBES`."],
    source: "asyncapi",
    scope: CHECKOUT_SCOPE,
    evidenceBase: CHECKOUT_AT,
    relations: [{ type: "SUBSCRIBES", from: CHECKOUT, to: "topic:catalog.product-created.v1", evidence: "src/main/java/com/example/checkout/catalog/ProductCreatedListener.java" }],
  },
  VERSION_OF: {
    who: "Quem lê a implantação (fonte `k8s-deployments`, escopo `{cluster, namespace}`): o serviço exposto com a versão no nome (`product-api-v2`) e cujo seletor casa com os pods do componente.",
    notes: [
      "Só para o versionamento na infraestrutura. Vai junto com o `PROVIDES` da API versionada, e a API versionada não tem endpoints próprios: `api_consumers` chega aos do código pelo `VERSION_OF`.",
      "No versionamento no código (`/v1/products`), cada versão é uma API com os próprios endpoints, publicada pelo contrato, e não há `VERSION_OF`.",
    ],
    source: "k8s-deployments",
    scope: ENV_SCOPE,
    evidenceBase: "k8s://example/catalog-dev/",
    nodes: [{ key: "api:product-api/v2/http", type: "Api", props: { name: "product-api-v2", kind: "http", version: "v2" }, evidence: "services/product-api-v2" }],
    relations: [
      { type: "PROVIDES", from: PRODUCT, to: "api:product-api/v2/http", evidence: "services/product-api-v2" },
      { type: "VERSION_OF", from: "api:product-api/v2/http", to: "api:product-api/http", evidence: "services/product-api-v2" },
    ],
  },
  SPECIFIED_BY: {
    who: "Quem lê o contrato: `openapi` e `asyncapi` no escopo do provedor, `pact` no escopo do consumidor.",
    notes: [
      "O contrato é um nó (`Contract`) com `kind` e, quando está publicado, `url`. A evidência aponta para o documento.",
      "As chaves: `contract:openapi/<serviço>`, `contract:asyncapi/<serviço>` e `contract:pact/<consumidor>→<provedor>`.",
    ],
    source: "openapi",
    scope: PRODUCT_SCOPE,
    evidenceBase: PRODUCT_AT,
    nodes: [
      { key: "contract:openapi/product-api", type: "Contract", props: { name: "product-api (OpenAPI)", kind: "openapi" }, evidence: "build/architecture/openapi.json" },
      { key: "contract:asyncapi/product-api", type: "Contract", props: { name: "product-api (AsyncAPI)", kind: "asyncapi" }, evidence: "build/architecture/asyncapi.json" },
    ],
    relations: [
      { type: "SPECIFIED_BY", from: "api:product-api/http", to: "contract:openapi/product-api", evidence: "build/architecture/openapi.json" },
      { type: "SPECIFIED_BY", from: "topic:catalog.product-created.v1", to: "contract:asyncapi/product-api", evidence: "build/architecture/asyncapi.json#/channels/productCreated" },
    ],
  },
  USES_RESOURCE: {
    who: "A configuração de implantação de cada serviço (fonte `service-config`, escopo `{component, environment}`): um retrato por componente e ambiente.",
    notes: [
      "O alvo costuma ser o recurso lógico (o banco, o bucket), `resource:<ambiente>/<instância>/<nome>`, que fica na instância por `HOSTED_ON`.",
      "`access` é `read`, `write` ou `read-write`. O que o código lê e escreve, tabela a tabela, é `READS`/`WRITES` em `Dataset`.",
    ],
    source: "service-config",
    scope: { component: "example/catalog/product-api", environment: "dev" },
    evidenceBase: `${PRODUCT_AT}deploy/values-dev.yaml`,
    relations: [{ type: "USES_RESOURCE", from: PRODUCT, to: "resource:dev/postgres/catalog", props: { access: "read-write" }, evidence: "#database" }],
  },
  HOSTED_ON: {
    who: "A configuração de implantação (fonte `service-config`) ou o inventário da infraestrutura (fonte `k8s-infra`): o banco na instância e o tópico no broker.",
    notes: ["Os dois pares: `Resource → Resource` (o recurso lógico na instância) e `Topic → Resource` (o tópico no broker)."],
    source: "service-config",
    scope: { component: "example/catalog/product-api", environment: "dev" },
    evidenceBase: `${PRODUCT_AT}deploy/values-dev.yaml`,
    nodes: [{ key: "resource:dev/postgres/catalog", type: "Resource", props: { name: "catalog", kind: "database" }, evidence: "#database" }],
    relations: [
      { type: "HOSTED_ON", from: "resource:dev/postgres/catalog", to: "resource:dev/postgres", evidence: "#database.host" },
      { type: "HOSTED_ON", from: "topic:catalog.product-created.v1", to: "resource:dev/kafka", evidence: "#kafka.bootstrapServers" },
    ],
  },
  INSTANCE_OF: {
    who: "O inventário da infraestrutura de cada ambiente (fonte `k8s-infra`, escopo `{cluster, namespace}`).",
    notes: [
      "Liga a instância de um ambiente ao componente de infraestrutura do catálogo (`Component` com `kind: infra`), que tem dono e repositório como qualquer componente.",
    ],
    source: "k8s-infra",
    scope: ENV_SCOPE,
    evidenceBase: "k8s://example/catalog-dev/",
    relations: [{ type: "INSTANCE_OF", from: "resource:dev/postgres", to: "component:example/platform/postgres", evidence: "statefulsets/postgres#spec.selector.matchLabels.app" }],
  },
  IN_ENVIRONMENT: {
    who: "O inventário da infraestrutura (fonte `k8s-infra`, escopo `{cluster, namespace}`).",
    notes: [
      "O nome do ambiente é livre e o mesmo do primeiro segmento da chave do recurso (`resource:dev/...` está em `env:dev`); o `kind` é o estágio fixo (`development`, `test`, `staging`, `production`).",
      "Afirme na instância; no recurso lógico, só quando a fonte o vê direto no ambiente, sem a instância.",
    ],
    source: "k8s-infra",
    scope: ENV_SCOPE,
    evidenceBase: "k8s://example/catalog-dev/",
    nodes: [
      { key: "env:dev", type: "Environment", props: { name: "dev", kind: "development" }, evidence: "namespaces/catalog-dev" },
      { key: "resource:dev/postgres", type: "Resource", props: { name: "postgres", kind: "database-server" }, evidence: "statefulsets/postgres" },
    ],
    relations: [{ type: "IN_ENVIRONMENT", from: "resource:dev/postgres", to: "env:dev", evidence: "statefulsets/postgres" }],
  },
  DEPLOYED_IN: {
    who: "Quem vê o que roda (fonte `k8s-deployments`, escopo `{cluster, namespace}`): um retrato por ambiente, com todas as implantações dele.",
    notes: [
      "`version` e `commit` são obrigatórios, e o `commit` é identidade: no canário ou no blue-green, são duas afirmações, uma por commit em execução.",
      "A implantação que sai do ambiente some do retrato seguinte e vira `stale`: é o histórico de deploys.",
      "Para o recorte do ambiente mostrar o que aquela versão oferecia e usava, quem vê o commit rodando publica também o retrato congelado dele (escopo com `commit` e `revision`, veja [Retrato congelado](#retrato-congelado)). Sem ele, o componente aparece no ambiente com o retrato da linha principal.",
    ],
    source: "k8s-deployments",
    scope: ENV_SCOPE,
    evidenceBase: "k8s://example/catalog-dev/",
    nodes: [{ key: "env:dev", type: "Environment", props: { name: "dev", kind: "development" }, evidence: "namespace/catalog-dev" }],
    relations: [
      {
        type: "DEPLOYED_IN",
        from: PRODUCT,
        to: "env:dev",
        props: { version: "1.5.0", commit: "4f2a9c1", image: "registry.example.com/product-api:1.5.0", replicas: "2" },
        evidence: "deployments/product-api",
      },
    ],
  },
  RUNS: {
    who: "O inventário da infraestrutura (fonte `k8s-infra`): a tecnologia e a versão de cada instância.",
    notes: ["O motor do banco (PostgreSQL, MongoDB) é `RUNS` da instância, e não propriedade do banco ou do dataset."],
    source: "k8s-infra",
    scope: ENV_SCOPE,
    evidenceBase: "k8s://example/catalog-dev/",
    relations: [{ type: "RUNS", from: "resource:dev/postgres", to: "tech:postgresql", props: { version: "16" }, evidence: "statefulsets/postgres#spec.template.spec.containers[0].image" }],
  },
  ROUTES: {
    who: "As regras de roteamento do ambiente (fonte `k8s-routes`, escopo `{cluster, namespace}`): ingress, gateway ou service mesh.",
    notes: [
      "`host` é obrigatório; `host` e `path` são identidade, então duas rotas do mesmo ingress para o mesmo componente são duas afirmações.",
      "É o caminho de rede, e não dependência: quem depende de quem continua em `CONSUMES`, e o gateway no meio não esconde o consumidor.",
    ],
    source: "k8s-routes",
    scope: ENV_SCOPE,
    evidenceBase: "k8s://example/catalog-dev/ingresses/",
    relations: [
      { type: "ROUTES", from: "resource:dev/ingress", to: PRODUCT, props: { host: "product-api.dev.example.com" }, evidence: "product-api" },
      { type: "ROUTES", from: "resource:dev/ingress", to: PRODUCT, props: { host: "api.dev.example.com", path: "/catalog" }, evidence: "public-api" },
    ],
  },
  REACHES_VIA: {
    who: "A configuração do consumidor que aponta para o gateway (fonte `service-config`). Nenhum adaptador do produto afirma esta relação: vem de um adaptador próprio ou da carga à mão.",
    notes: ["Completa `ROUTES`: o consumidor chega ao gateway, e o gateway encaminha ao provedor. A dependência continua em `CONSUMES`."],
    source: "service-config",
    scope: { component: "example/checkout/checkout-api", environment: "dev" },
    evidenceBase: `${CHECKOUT_AT}deploy/values-dev.yaml`,
    relations: [{ type: "REACHES_VIA", from: CHECKOUT, to: "resource:dev/ingress", evidence: "#catalog.baseUrl" }],
  },
  BUILT_WITH: {
    who: "O build de cada componente (fonte `build-manifest`, escopo `{component}`).",
    notes: ["A tecnologia vai em minúsculas (`tech:spring-boot`), e a versão é a que o build usou."],
    source: "build-manifest",
    scope: PRODUCT_SCOPE,
    evidenceBase: `${PRODUCT_AT}build/architecture/manifest.json`,
    relations: [
      { type: "BUILT_WITH", from: PRODUCT, to: "tech:java", props: { version: "25" }, evidence: "#/component/technologies/0" },
      { type: "BUILT_WITH", from: PRODUCT, to: "tech:spring-boot", props: { version: "4.0.1" }, evidence: "#/component/technologies/1" },
    ],
  },
  DEPENDS_ON: {
    who: "O SBOM do build (fonte `sbom`: `version`, `scope`, `resolved`, `direct`, `via`) e a análise de uso das dependências (fonte `dependency-usage`: `declared`, `used`), cada um no escopo `{component}`.",
    notes: [
      "A biblioteca é identificada sem versão (`lib:maven/<grupo>:<artefato>`); a versão é da relação, e duas fontes podem divergir nela.",
      "Na transitiva, `direct: false` e `via` com as chaves das dependências diretas que a trazem.",
      "`scope` é o classpath (`compile`, `runtime`, `test`), e não a configuração do build em que a dependência é declarada (`implementation`, `api`).",
    ],
    source: "sbom",
    scope: PRODUCT_SCOPE,
    evidenceBase: `${PRODUCT_AT}build/architecture/bom.json`,
    relations: [
      {
        type: "DEPENDS_ON",
        from: PRODUCT,
        to: "lib:maven/org.springframework.boot:spring-boot-starter-web",
        props: { version: "4.0.1", scope: "runtime", resolved: true, direct: true },
        evidence: "#pkg:maven/org.springframework.boot/spring-boot-starter-web@4.0.1",
      },
      {
        type: "DEPENDS_ON",
        from: PRODUCT,
        to: "lib:maven/com.fasterxml.jackson.core:jackson-databind",
        props: { version: "2.20.0", scope: "runtime", resolved: true, direct: false, via: ["lib:maven/org.springframework.boot:spring-boot-starter-web"] },
        evidence: "#pkg:maven/com.fasterxml.jackson.core/jackson-databind@2.20.0",
      },
    ],
  },
  PRODUCES: {
    who: "O build do componente que gera a biblioteca (fonte `build-manifest`, escopo `{component}`).",
    notes: ["Liga o repositório de uma biblioteca interna aos usos dela: `library_usage` parte do componente e chega a quem tem `DEPENDS_ON` para os pacotes que ele produz."],
    source: "build-manifest",
    scope: { component: "example/platform/commons" },
    evidenceBase: "example/platform/commons@71c0e2a:build/architecture/manifest.json",
    relations: [{ type: "PRODUCES", from: "component:example/platform/commons", to: "lib:maven/com.example:commons-web", props: { version: "3.2.0" }, evidence: "#/component/libraries/0" }],
  },
  OWNS_DATA: {
    who: "O acesso a dados lido do código (fonte `data-access`, escopo `{component}`).",
    notes: [
      "O dataset é identificado pelo componente que o mapeia: `dataset:<caminho do componente>/<nome>`. O build não sabe em que banco de cada ambiente ele está.",
      "`OWNS_DATA` é de quem define a estrutura (o mapeamento ou a migração); quem só lê ou escreve tem `READS`/`WRITES`.",
    ],
    source: "data-access",
    scope: PRODUCT_SCOPE,
    evidenceBase: PRODUCT_AT,
    nodes: [{ key: "dataset:example/catalog/product-api/products", type: "Dataset", props: { name: "products", kind: "table", store: "relational" }, evidence: "src/main/java/com/example/catalog/ProductEntity.java" }],
    relations: [{ type: "OWNS_DATA", from: PRODUCT, to: "dataset:example/catalog/product-api/products", evidence: "src/main/java/com/example/catalog/ProductEntity.java" }],
  },
  READS: {
    who: "O acesso a dados lido do código (fonte `data-access`), no mesmo retrato do `OWNS_DATA`.",
    notes: ["A evidência é o ponto do código que faz a leitura, com a linha quando houver."],
    source: "data-access",
    scope: PRODUCT_SCOPE,
    evidenceBase: PRODUCT_AT,
    relations: [{ type: "READS", from: PRODUCT, to: "dataset:example/catalog/product-api/products", evidence: "src/main/java/com/example/catalog/ProductService.java:24" }],
  },
  WRITES: {
    who: "O acesso a dados lido do código (fonte `data-access`), no mesmo retrato do `OWNS_DATA`.",
    notes: ["Leitura e escrita do mesmo dataset são duas relações, `READS` e `WRITES`."],
    source: "data-access",
    scope: PRODUCT_SCOPE,
    evidenceBase: PRODUCT_AT,
    relations: [{ type: "WRITES", from: PRODUCT, to: "dataset:example/catalog/product-api/products", evidence: "src/main/java/com/example/catalog/ProductService.java:41" }],
  },
};

/** O retrato de exemplo de uma relação, como vai no corpo do POST /v1/ingest. */
export function exampleSnapshot(type: RelationType): IngestBody {
  const g = RELATION_GUIDE[type];
  return {
    source: g.source,
    scope: g.scope,
    observedAt: OBSERVED_AT,
    ...(g.evidenceBase ? { evidenceBase: g.evidenceBase } : {}),
    nodes: g.nodes ?? [],
    relations: g.relations,
  };
}

/** JSON com um fato por linha: o retrato fica legível sem esconder nenhum campo. */
function renderSnapshot(body: IngestBody): string {
  const fields = Object.entries(body).filter(([k]) => k !== "nodes" && k !== "relations");
  const list = (items: unknown[]) => (items.length === 0 ? "[]" : `[\n${items.map((i) => `    ${JSON.stringify(i)}`).join(",\n")}\n  ]`);
  const lines = [
    ...fields.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`),
    `  "nodes": ${list(body.nodes)}`,
    `  "relations": ${list(body.relations)}`,
  ];
  return `{\n${lines.join(",\n")}\n}`;
}

const code = (s: string) => `\`${s}\``;

/** O catálogo gerado, sem os marcadores. */
export function relationsSection(): string {
  const lines: string[] = [];
  for (const type of RELATION_TYPE_NAMES) {
    const spec = relationSpec(type);
    const g = RELATION_GUIDE[type];
    lines.push(`### ${code(type)}`, "");
    lines.push(`${spec.description}.`, "");
    lines.push(`- **Liga:** ${spec.pairs.map(([f, t]) => `${code(f)} → ${code(t)}`).join(", ")}.`);
    const props = Object.entries(spec.props).map(([name, p]) => {
      const marks = [spec.identityProps.includes(name) ? "identidade" : "", p.required ? "obrigatória" : ""].filter(Boolean);
      return `${code(name)}${marks.length ? ` (${marks.join(", ")})` : ""}`;
    });
    lines.push(`- **Propriedades:** ${props.length ? props.join(", ") : "nenhuma"}.`);
    lines.push(`- **Quem afirma:** ${g.who}`);
    for (const n of g.notes) lines.push(`- ${n}`);
    lines.push("", "```json", renderSnapshot(exampleSnapshot(type)), "```", "");
  }
  return lines.join("\n").trimEnd();
}

/** O ADAPTADOR.md com o catálogo de relações da versão atual. */
export function renderAdaptador(current: string): string {
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start < 0 || end < start) throw new Error(`ADAPTADOR.md sem os marcadores ${START} e ${END}`);
  return `${current.slice(0, start + START.length)}\n${relationsSection()}\n${current.slice(end)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(ADAPTADOR_PATH, renderAdaptador(readFileSync(ADAPTADOR_PATH, "utf8")));
  console.log(`Gravado ${ADAPTADOR_PATH}`);
}
