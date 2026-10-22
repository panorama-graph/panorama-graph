import { NODE_TYPES, type NodeType } from "./generated/model.js";

/**
 * Receitas de chave do grafo. A API define o formato `<prefixo>:<identificador>` e o prefixo de cada tipo (o
 * modelo); as receitas dizem como montar o identificador, e precisam ser as mesmas em todos os produtores para que
 * fatos de fontes diferentes caiam no mesmo nó.
 */

const key = (type: NodeType, id: string) => `${NODE_TYPES[type].prefix}:${id}`;

const TYPE_BY_PREFIX = new Map<string, NodeType>(
  (Object.keys(NODE_TYPES) as NodeType[]).map((type) => [NODE_TYPES[type].prefix, type]),
);

/** Tipo do nó pelo prefixo da chave, segundo o modelo. */
export function nodeTypeFromKey(k: string): NodeType | undefined {
  const i = k.indexOf(":");
  return i > 0 ? TYPE_BY_PREFIX.get(k.slice(0, i)) : undefined;
}

/** Componente pelo caminho do repositório (ex.: `example/catalog/product-api`). */
export const componentKey = (path: string) => key("Component", path);

/** Repositório pelo host e caminho (ex.: `git.example.com/example/catalog/product-api`). */
export const repositoryKey = (host: string, path: string) => key("Repository", `${host}/${path}`);

/** Serviço e, quando a interface é versionada, a versão (`product-api/v1`). */
const versioned = (service: string, version?: string) => {
  const v = version ? (normalizeInterfaceVersion(version) ?? version) : undefined;
  return v ? `${service}/${v}` : service;
};

/**
 * API HTTP de um serviço, pelo nome com que ele é conhecido pelos clientes (o participante nos pacts), sem a versão
 * que vai no host. Uma API versionada é um nó por versão: `api:product-api/v1/http`; sem versão, `api:product-api/http`.
 */
export const httpApiKey = (service: string, version?: string) => key("Api", `${versioned(service, version)}/http`);

/**
 * Operação de uma API HTTP. A versão é a do código (a do caminho ou a declarada pela fonte), nunca a do host: o
 * serviço exposto como `product-api-v2` serve as operações do código, com as mesmas chaves. Os nomes dos parâmetros
 * saem da chave (`/products/{id}` e `/products/{productId}` são a mesma operação), porque o provedor e cada cliente
 * os nomeiam como querem.
 */
export const endpointKey = (service: string, method: string, path: string, version?: string) =>
  key("Endpoint", `${versioned(service, version)}/${method.toUpperCase()} ${normalizePath(path)}`);

/** Tópico pelo endereço no broker. A versão, quando há, já está no nome (`product-created.v1`). */
export const topicKey = (name: string) => key("Topic", name);

/**
 * Convenção de versão das interfaces: a versão maior, `v<N>`, e só ela. Duas versões que convivem são nós
 * diferentes; a interface sem versão não tem nenhuma. A fonte pode declarar a versão; sem declaração, ela é lida:
 * - no caminho, pelo primeiro segmento (versionamento no código): `/v1/products` → `v1`;
 * - no host, pelo nome do serviço exposto (versionamento na infraestrutura): `product-api-v2` → `product-api`, `v2`.
 *   O cliente consome a API daquela versão, e quem lê a implantação a liga à API do código (`VERSION_OF`);
 * - no nome do tópico, no fim: `product-created-v1` ou `product-created.v1` → `v1`.
 */
export function normalizeInterfaceVersion(raw: string | undefined): string | undefined {
  const m = raw === undefined ? null : /^v?(\d+)$/i.exec(raw.trim());
  return m ? `v${Number(m[1])}` : undefined;
}

/** Nome de serviço exposto com a versão da infraestrutura: `product-api-v2` é o serviço `product-api`, versão `v2`. */
export function splitServiceVersion(name: string): { service: string; version?: string } {
  const m = /^(.+)-v(\d+)$/i.exec(name);
  return m ? { service: m[1], version: `v${Number(m[2])}` } : { service: name };
}

/** Versão no primeiro segmento do caminho: `/v1/products` → `v1`; `/products` → undefined. */
export function pathVersion(path: string): string | undefined {
  const m = /^\/*v(\d+)(?:\/|$)/i.exec(path);
  return m ? `v${Number(m[1])}` : undefined;
}

/** Versão no fim do nome do tópico: `product-created-v1` ou `product-created.v1` → `v1`. */
export function topicVersion(name: string): string | undefined {
  const m = /[-.]v(\d+)$/i.exec(name);
  return m ? `v${Number(m[1])}` : undefined;
}

export const contractKey = (kind: "openapi" | "asyncapi" | "pact" | "schema", id: string) => key("Contract", `${kind}/${id}`);

/**
 * Dataset (coleção, tabela) pelo componente que o mapeia e o nome. O build não sabe em que banco de cada ambiente
 * ele está; por isso a identidade é do componente, e não do banco.
 */
export const datasetKey = (componentPath: string, name: string) => key("Dataset", `${componentPath}/${name}`);

export const technologyKey = (name: string) => key("Technology", name.toLowerCase());

/** Domínio, sistema e grupo pelo identificador curto na fonte (ex.: `catalog`, `team-catalog`). */
export const domainKey = (slug: string) => key("Domain", slug);
export const systemKey = (slug: string) => key("System", slug);
export const groupKey = (slug: string) => key("Group", slug);

/** Nível da estrutura organizacional pelo nome que a organização usa (ex.: `level:tribo`). */
export const levelKey = (slug: string) => key("OrgLevel", slug);

/** Pessoa pelo login no diretório (ex.: `ana.silva`). */
export const personKey = (login: string) => key("Person", login);

/**
 * Recurso de infraestrutura pelo ambiente e nome: instância `resource:<ambiente>/<nome>` (ex.: `resource:dev/mongodb`),
 * recurso lógico dentro dela `resource:<ambiente>/<instância>/<nome>` (ex.: `resource:dev/mongodb/product-api`).
 */
export const resourceKey = (environment: string, ...names: string[]) => key("Resource", `${environment}/${names.join("/")}`);

/**
 * Ambiente pelo nome curto que a infraestrutura usa (ex.: `env:prd`). É o mesmo nome do primeiro segmento da chave
 * do recurso: a instância `resource:prd/mongodb` está no ambiente `env:prd` (`IN_ENVIRONMENT`).
 */
export const environmentKey = (name: string) => key("Environment", name);

/** Biblioteca pelas coordenadas sem versão. Maven fica `lib:maven/<grupo>:<artefato>`; os demais tipos, `lib:<tipo>/<namespace>/<nome>`. */
export function libraryKey(type: string, namespace: string | undefined, name: string): string {
  if (!namespace) return key("Library", `${type}/${name}`);
  return key("Library", type === "maven" ? `maven/${namespace}:${name}` : `${type}/${namespace}/${name}`);
}

/** Caminho com os parâmetros anônimos, sem barra final e com uma barra só entre segmentos. */
export function normalizePath(path: string): string {
  const p = ("/" + path).replace(/\/+/g, "/").replace(/\{[^}]*\}/g, "{}");
  return p.length > 1 ? p.replace(/\/$/, "") : p;
}
