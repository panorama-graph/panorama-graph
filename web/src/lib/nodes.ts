/** Tipos de nó do modelo, pelo prefixo da chave (`<prefixo>:<identificador>`), e os caminhos do console. */
export const NODE_TYPES: Record<string, { prefix: string; label: string; plural: string }> = {
  Domain: { prefix: "domain", label: "Domínio", plural: "Domínios" },
  System: { prefix: "system", label: "Sistema", plural: "Sistemas" },
  Component: { prefix: "component", label: "Componente", plural: "Componentes" },
  Repository: { prefix: "repo", label: "Repositório", plural: "Repositórios" },
  Api: { prefix: "api", label: "API", plural: "APIs" },
  Endpoint: { prefix: "endpoint", label: "Endpoint", plural: "Endpoints" },
  Topic: { prefix: "topic", label: "Tópico", plural: "Tópicos" },
  Contract: { prefix: "contract", label: "Contrato", plural: "Contratos" },
  Resource: { prefix: "resource", label: "Recurso", plural: "Recursos" },
  Group: { prefix: "group", label: "Grupo", plural: "Grupos" },
  OrgLevel: { prefix: "level", label: "Nível", plural: "Níveis" },
  Person: { prefix: "person", label: "Pessoa", plural: "Pessoas" },
  Technology: { prefix: "tech", label: "Tecnologia", plural: "Tecnologias" },
  Library: { prefix: "lib", label: "Biblioteca", plural: "Bibliotecas" },
  Dataset: { prefix: "dataset", label: "Dataset", plural: "Datasets" },
  Environment: { prefix: "env", label: "Ambiente", plural: "Ambientes" },
};

/** Ordem dos ambientes pelo estágio (`kind` do `Environment`) até a produção; sem estágio, no fim. */
const ENVIRONMENT_ORDER = ["development", "test", "staging", "production"];

/**
 * O ambiente de um recurso: o que ele afirma direto ou o da instância em que está (o banco herda o do servidor).
 * Quando há mais de um, as fontes discordam, e todos aparecem.
 */
export function environmentsOf(resource: {
  environments?: { key: string; name?: string; kind?: string }[];
  hostedOn?: { environments?: { key: string; name?: string; kind?: string }[] }[];
}): { key: string; name: string; rank: number }[] {
  const all = [...(resource.environments ?? []), ...(resource.hostedOn ?? []).flatMap((h) => h.environments ?? [])];
  const byKey = new Map(all.map((e) => [e.key, { key: e.key, name: displayName(e), rank: environmentRank(e.kind) }]));
  return [...byKey.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

/** Posição do estágio do ambiente na ordem até a produção. */
export function environmentRank(kind: string | undefined): number {
  const i = kind ? ENVIRONMENT_ORDER.indexOf(kind) : -1;
  return i >= 0 ? i : ENVIRONMENT_ORDER.length;
}

/** Categoria do banco de um dataset (`store`), como a pessoa fala. */
export const STORE_LABEL: Record<string, string> = {
  relational: "banco relacional",
  document: "banco de documentos",
  "key-value": "banco chave-valor",
  "wide-column": "banco colunar",
  search: "motor de busca",
  graph: "banco de grafo",
  "time-series": "banco de séries temporais",
  object: "armazenamento de objetos",
};

/**
 * Tópico ou fila (`kind` do `Topic`): os nomes do canal e das duas pontas. No tópico, cada assinante recebe todas as
 * mensagens; na fila, cada mensagem vai para um só consumidor. Sem `kind`, tópico.
 */
export function channelWords(kind: unknown) {
  return kind === "queue"
    ? { noun: "fila", the: "A fila", publish: "envia", subscribe: "consome", publishers: "Enviam", subscribers: "Consomem" }
    : { noun: "tópico", the: "O tópico", publish: "publica", subscribe: "assina", publishers: "Publicam", subscribers: "Assinam" };
}

const TYPE_BY_PREFIX = new Map(Object.entries(NODE_TYPES).map(([type, spec]) => [spec.prefix, type]));

export function typeOfKey(key: string): string | undefined {
  const i = key.indexOf(":");
  return i > 0 ? TYPE_BY_PREFIX.get(key.slice(0, i)) : undefined;
}

export const typeLabel = (type: string | undefined) => (type && NODE_TYPES[type]?.label) || type || "Nó";

export const nodePath = (key: string) => `/n/${encodeURIComponent(key)}`;

/**
 * Nome para exibir: o `name` do nó ou o último segmento da chave. Endpoint e API levam o serviço na chave
 * (`endpoint:svc/GET /x/{}`, `api:svc/http`): do endpoint fica o método e o caminho; da API, a chave inteira.
 */
export function displayName(node: { key: string; name?: string | null }): string {
  if (node.name) return node.name;
  const id = node.key.slice(node.key.indexOf(":") + 1);
  const type = typeOfKey(node.key);
  if (type === "Endpoint" && id.includes("/")) return id.slice(id.indexOf("/") + 1);
  if (type === "Api") return id;
  const slash = id.lastIndexOf("/");
  return slash >= 0 && slash < id.length - 1 ? id.slice(slash + 1) : id;
}

/** Rótulos das relações do modelo, no sentido da seta (out) e no inverso (in). */
export const RELATION_LABELS: Record<string, { out: string; in: string }> = {
  PART_OF: { out: "Faz parte de", in: "Contém" },
  OWNED_BY: { out: "Dono", in: "É dono de" },
  MEMBER_OF: { out: "Membro de", in: "Membros" },
  HOSTED_IN: { out: "Repositório", in: "Código de" },
  PROVIDES: { out: "Oferece", in: "Oferecida por" },
  HAS_ENDPOINT: { out: "Endpoints", in: "Da API" },
  CONSUMES: { out: "Consome", in: "Consumida por" },
  CALLS: { out: "Chama", in: "Chamado por" },
  PUBLISHES: { out: "Publica", in: "Publicado por" },
  SUBSCRIBES: { out: "Assina", in: "Assinado por" },
  SPECIFIED_BY: { out: "Contrato", in: "Especifica" },
  USES_RESOURCE: { out: "Usa", in: "Usado por" },
  HOSTED_ON: { out: "Hospedado em", in: "Hospeda" },
  IN_ENVIRONMENT: { out: "No ambiente", in: "Recursos do ambiente" },
  DEPLOYED_IN: { out: "Implantado em", in: "Componentes implantados" },
  RUNS: { out: "Roda", in: "Rodando em" },
  ROUTES: { out: "Roteia para", in: "Recebe rota de" },
  REACHES_VIA: { out: "Sai por", in: "Saída de" },
  BUILT_WITH: { out: "Construído com", in: "Usada por" },
  DEPENDS_ON: { out: "Depende de", in: "Usada por" },
  OWNS_DATA: { out: "Dono da estrutura de", in: "Estrutura de" },
  READS: { out: "Lê", in: "Lido por" },
  WRITES: { out: "Escreve", in: "Escrito por" },
};

export const relationLabel = (type: string, direction: "out" | "in" = "out") => RELATION_LABELS[type]?.[direction] ?? type;
