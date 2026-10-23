/**
 * Modelo v12 do grafo: tipos de nó, tipos de relação, pares válidos e propriedades.
 *
 * É fechado: a API recusa o que estiver fora. Tipo novo é mudança versionada
 * (este arquivo + MODEL_VERSION + MODELO.md), nunca algo que um adaptador inventa.
 * Module e CONTAINS (banco → dataset) ainda não fazem parte.
 */

export const MODEL_VERSION = 12;

export type PropSpec = {
  type: "string" | "number" | "boolean" | "string[]";
  enum?: readonly string[];
  required?: boolean;
  description: string;
};

export type NodeTypeSpec = {
  prefix: string;
  description: string;
  props: Record<string, PropSpec>;
};

export type RelationTypeSpec = {
  description: string;
  nature: string;
  pairs: readonly (readonly [NodeType, NodeType])[];
  props: Record<string, PropSpec>;
  /** Propriedades que distinguem duas afirmações da mesma fonte entre os mesmos nós. */
  identityProps: readonly string[];
};

const COMMON_NODE_PROPS: Record<string, PropSpec> = {
  name: { type: "string", description: "Nome legível" },
  description: { type: "string", description: "Descrição curta" },
};

const interfaceVersion =
  "Versão maior da interface (v1, v2): a declarada pela fonte ou, pela convenção, a do primeiro segmento do caminho, " +
  "a do nome do serviço no host (servico-xpto-v2) ou a do fim do nome do tópico. Ausente quando a interface não é versionada";

function kindProp(values: readonly string[]): PropSpec {
  return { type: "string", enum: values, description: `Subtipo: ${values.join(", ")}` };
}

export const RESOURCE_INSTANCE_KINDS = ["database-server", "broker", "cache", "gateway", "ingress"] as const;
export const RESOURCE_LOGICAL_KINDS = ["database", "bucket"] as const;

/**
 * Categoria do banco de um dataset. O motor (MongoDB, PostgreSQL, Cassandra) não é propriedade: é `RUNS` da instância
 * para a tecnologia, como em todo recurso.
 */
export const DATASET_STORES = ["relational", "document", "key-value", "wide-column", "search", "graph", "time-series", "object"] as const;

/** Estágio do ambiente no caminho até a produção. */
export const ENVIRONMENT_KINDS = ["development", "test", "staging", "production"] as const;

/** `infra`: infraestrutura implantável do catálogo (servidor de banco, broker, cache), com instâncias por ambiente. */
export const COMPONENT_KINDS = ["service", "bff", "frontend", "job", "library", "infra"] as const;

export const NODE_TYPES = {
  Domain: { prefix: "domain", description: "Domínio de negócio", props: {} },
  System: { prefix: "system", description: "Conjunto de componentes que entregam uma capacidade", props: {} },
  Component: {
    prefix: "component",
    description: "Unidade implantável",
    props: { kind: kindProp(COMPONENT_KINDS) },
  },
  Repository: {
    prefix: "repo",
    description: "Repositório de código",
    props: { url: { type: "string", description: "URL do repositório" } },
  },
  Api: {
    prefix: "api",
    description: "Interface oferecida. Duas versões que convivem (v1 e v2) são duas APIs",
    props: { kind: kindProp(["http", "event"]), version: { type: "string", description: interfaceVersion } },
  },
  Endpoint: {
    prefix: "endpoint",
    description: "Operação de uma API HTTP",
    props: {
      method: { type: "string", description: "Método HTTP" },
      path: { type: "string", description: "Caminho, com parâmetros entre chaves" },
      operationId: { type: "string", description: "Identificador da operação no contrato (operationId do OpenAPI)" },
      contract: {
        type: "string",
        description:
          "Contrato da operação em JSON: format, parameters, requestBody, responses e, em components, o fecho " +
          "dos $ref locais (schemas, parameters, responses, requestBodies), como no documento de origem",
      },
    },
  },
  Topic: {
    prefix: "topic",
    description: "Canal de eventos: tópico (cada assinante recebe todas as mensagens) ou fila (cada mensagem vai para um só consumidor). Cada versão é um canal, com o próprio nome",
    props: { kind: kindProp(["topic", "queue"]), version: { type: "string", description: interfaceVersion } },
  },
  Contract: {
    prefix: "contract",
    description: "Especificação ou contrato",
    props: {
      kind: kindProp(["openapi", "asyncapi", "pact", "schema"]),
      url: { type: "string", description: "Onde o contrato está publicado" },
    },
  },
  Resource: {
    prefix: "resource",
    description: "Infraestrutura: instância (servidor, broker, gateway) ou recurso lógico (banco, bucket)",
    props: { kind: kindProp([...RESOURCE_INSTANCE_KINDS, ...RESOURCE_LOGICAL_KINDS]) },
  },
  Group: { prefix: "group", description: "Time ou unidade organizacional", props: {} },
  OrgLevel: {
    prefix: "level",
    description:
      "Nível da estrutura organizacional, no vocabulário da organização (diretoria, tribo, time). Cada grupo diz o " +
      "seu nível por AT_LEVEL",
    props: {
      order: { type: "number", description: "Posição de cima para baixo na estrutura (1 é o topo). Níveis laterais, como chapters, repetem a posição" },
      team: { type: "boolean", description: "Os grupos deste nível são times: entregam e são donos de componentes" },
    },
  },
  Person: {
    prefix: "person",
    description: "Pessoa",
    props: { email: { type: "string", description: "E-mail" } },
  },
  Technology: { prefix: "tech", description: "Linguagem, runtime ou framework", props: {} },
  Library: { prefix: "lib", description: "Pacote de dependência (coordenadas sem versão)", props: {} },
  Dataset: {
    prefix: "dataset",
    description: "Estrutura de dados (coleção, tabela, visão), identificada pelo componente que a mapeia",
    props: {
      kind: kindProp(["collection", "table", "view"]),
      store: { type: "string", enum: DATASET_STORES, description: `Categoria do banco: ${DATASET_STORES.join(", ")}` },
    },
  },
  Environment: {
    prefix: "env",
    description: "Ambiente em que a infraestrutura e os componentes estão implantados (desenvolvimento, homologação, produção)",
    props: { kind: kindProp(ENVIRONMENT_KINDS) },
  },
} as const satisfies Record<string, NodeTypeSpec>;

export type NodeType = keyof typeof NODE_TYPES;

const version: PropSpec = { type: "string", description: "Versão" };

export const RELATION_TYPES = {
  PART_OF: {
    description: "Pertence a",
    nature: "estrutura",
    pairs: [["System", "Domain"], ["Component", "System"], ["Group", "Group"]],
    props: {},
    identityProps: [],
  },
  OWNED_BY: {
    description: "É de responsabilidade de",
    nature: "organização",
    pairs: [["Component", "Group"], ["System", "Group"], ["Domain", "Group"], ["Api", "Group"]],
    props: {},
    identityProps: [],
  },
  MEMBER_OF: {
    description: "Pessoa é membro do grupo",
    nature: "organização",
    pairs: [["Person", "Group"]],
    props: {
      role: { type: "string", description: "Papel no grupo" },
      lead: { type: "boolean", description: "Lidera o grupo" },
    },
    identityProps: [],
  },
  AT_LEVEL: {
    description: "Grupo está no nível da estrutura organizacional",
    nature: "organização",
    pairs: [["Group", "OrgLevel"]],
    props: {},
    identityProps: [],
  },
  HOSTED_IN: {
    description: "Código do componente está no repositório",
    nature: "estrutura",
    pairs: [["Component", "Repository"]],
    props: {},
    identityProps: [],
  },
  PROVIDES: {
    description: "Componente oferece a API",
    nature: "lógica",
    pairs: [["Component", "Api"]],
    props: {},
    identityProps: [],
  },
  HAS_ENDPOINT: {
    description: "API tem a operação",
    nature: "estrutura",
    pairs: [["Api", "Endpoint"]],
    props: {},
    identityProps: [],
  },
  CONSUMES: {
    description: "Componente consome a API",
    nature: "lógica",
    pairs: [["Component", "Api"]],
    props: {},
    identityProps: [],
  },
  CALLS: {
    description: "Componente chama a operação",
    nature: "lógica",
    pairs: [["Component", "Endpoint"]],
    props: {},
    identityProps: [],
  },
  PUBLISHES: {
    description: "Componente publica no tópico",
    nature: "lógica",
    pairs: [["Component", "Topic"]],
    props: {},
    identityProps: [],
  },
  SUBSCRIBES: {
    description: "Componente consome do tópico",
    nature: "lógica",
    pairs: [["Component", "Topic"]],
    props: {},
    identityProps: [],
  },
  VERSION_OF: {
    description:
      "API versionada na infraestrutura (o serviço exposto com a versão no nome, servico-xpto-v2) é a API do código " +
      "implantada sob esse nome: os endpoints são os da API do código",
    nature: "física",
    pairs: [["Api", "Api"]],
    props: {},
    identityProps: [],
  },
  SPECIFIED_BY: {
    description: "Especificado pelo contrato",
    nature: "contrato",
    pairs: [["Api", "Contract"], ["Topic", "Contract"]],
    props: {},
    identityProps: [],
  },
  USES_RESOURCE: {
    description: "Componente usa o recurso",
    nature: "lógica",
    pairs: [["Component", "Resource"]],
    props: { access: { type: "string", enum: ["read", "write", "read-write"], description: "Tipo de acesso" } },
    identityProps: [],
  },
  HOSTED_ON: {
    description: "Recurso lógico está na instância; tópico está no broker",
    nature: "física",
    pairs: [["Resource", "Resource"], ["Topic", "Resource"]],
    props: {},
    identityProps: [],
  },
  INSTANCE_OF: {
    description: "Instância é a implantação, num ambiente, do componente de infraestrutura",
    nature: "física",
    pairs: [["Resource", "Component"]],
    props: {},
    identityProps: [],
  },
  IN_ENVIRONMENT: {
    description: "Recurso está no ambiente: a instância, ou o recurso lógico quando a fonte o afirma direto",
    nature: "física",
    pairs: [["Resource", "Environment"]],
    props: {},
    identityProps: [],
  },
  DEPLOYED_IN: {
    description:
      "Componente está implantado no ambiente, numa versão. Uma afirmação por commit em execução (duas no canário ou no blue-green)",
    nature: "física",
    pairs: [["Component", "Environment"]],
    props: {
      version: { type: "string", required: true, description: "Versão do artefato em execução (rótulo, ex.: 1.4.0 ou 1.5.0-RC.2)" },
      commit: { type: "string", required: true, description: "Commit de que o artefato em execução foi construído" },
      image: { type: "string", description: "Imagem em execução" },
      replicas: { type: "string", description: "Réplicas pedidas" },
    },
    identityProps: ["commit"],
  },
  RUNS: {
    description: "Instância roda a tecnologia",
    nature: "stack",
    pairs: [["Resource", "Technology"]],
    props: { version },
    identityProps: [],
  },
  ROUTES: {
    description: "Gateway ou ingress encaminha para o componente",
    nature: "física",
    pairs: [["Resource", "Component"]],
    props: {
      host: { type: "string", required: true, description: "Host da rota" },
      path: { type: "string", description: "Prefixo de caminho da rota" },
    },
    identityProps: ["host", "path"],
  },
  REACHES_VIA: {
    description: "Componente chega a outros pelo gateway ou ingress",
    nature: "física",
    pairs: [["Component", "Resource"]],
    props: {},
    identityProps: [],
  },
  BUILT_WITH: {
    description: "Componente é construído com a tecnologia",
    nature: "stack",
    pairs: [["Component", "Technology"]],
    props: { version },
    identityProps: [],
  },
  DEPENDS_ON: {
    description: "Componente depende da biblioteca",
    nature: "stack",
    pairs: [["Component", "Library"]],
    props: {
      version,
      scope: { type: "string", description: "Classpath em que a dependência está (compile, runtime, test...)" },
      resolved: { type: "boolean", description: "Versão resolvida pelo build (e não só declarada)" },
      direct: { type: "boolean", description: "Dependência direta do componente (false: só chega por outra)" },
      via: {
        type: "string[]",
        description: "Na transitiva: as dependências diretas (chaves de biblioteca) que a trazem para o componente",
      },
      declared: { type: "boolean", description: "Declarada no build do componente" },
      used: { type: "boolean", description: "Usada pelo código do componente (análise do bytecode)" },
    },
    identityProps: [],
  },
  PRODUCES: {
    description:
      "O build do componente gera a biblioteca: o pacote que os outros componentes usam (DEPENDS_ON) sai deste repositório",
    nature: "stack",
    pairs: [["Component", "Library"]],
    props: { version: { type: "string", description: "Versão do pacote gerada no build afirmado" } },
    identityProps: [],
  },
  OWNS_DATA: {
    description: "Componente define a estrutura do dataset (mapeamento ou migração)",
    nature: "dados",
    pairs: [["Component", "Dataset"]],
    props: {},
    identityProps: [],
  },
  READS: {
    description: "Componente lê o dataset",
    nature: "dados",
    pairs: [["Component", "Dataset"]],
    props: {},
    identityProps: [],
  },
  WRITES: {
    description: "Componente escreve no dataset",
    nature: "dados",
    pairs: [["Component", "Dataset"]],
    props: {},
    identityProps: [],
  },
} as const satisfies Record<string, RelationTypeSpec>;

export type RelationType = keyof typeof RELATION_TYPES;

export const NODE_TYPE_NAMES = Object.keys(NODE_TYPES) as NodeType[];
export const RELATION_TYPE_NAMES = Object.keys(RELATION_TYPES) as RelationType[];

export function isNodeType(t: string): t is NodeType {
  return Object.hasOwn(NODE_TYPES, t);
}

export function isRelationType(t: string): t is RelationType {
  return Object.hasOwn(RELATION_TYPES, t);
}

export function nodeProps(type: NodeType): Record<string, PropSpec> {
  return { ...COMMON_NODE_PROPS, ...NODE_TYPES[type].props };
}

export function relationSpec(type: RelationType): RelationTypeSpec {
  return RELATION_TYPES[type] as RelationTypeSpec;
}

export function isValidPair(type: RelationType, from: NodeType, to: NodeType): boolean {
  return relationSpec(type).pairs.some(([f, t]) => f === from && t === to);
}

/** Campos de proveniência gravados em toda afirmação. Nenhuma propriedade do modelo pode usar esses nomes. */
export const PROVENANCE_FIELDS = [
  "id",
  "source",
  "scopeKey",
  "evidence",
  "state",
  "status",
  "firstObservedAt",
  "observedAt",
  "loadId",
  "revision",
] as const;

export const FACT_STATES = ["observed", "inferred", "confirmed"] as const;
export const FACT_STATUSES = ["current", "stale"] as const;

/** Valida propriedades contra a especificação. Devolve mensagens de erro (vazio = ok). */
export function validateProps(specs: Record<string, PropSpec>, props: Record<string, unknown>, where: string): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(props)) {
    const spec = specs[name];
    if (!spec) {
      errors.push(`${where}: propriedade desconhecida "${name}" (aceitas: ${Object.keys(specs).join(", ") || "nenhuma"})`);
      continue;
    }
    if (value === null || value === undefined) continue;
    const ok = spec.type === "string[]" ? Array.isArray(value) && value.every((v) => typeof v === "string") : typeof value === spec.type;
    if (!ok) {
      errors.push(`${where}: "${name}" deve ser ${spec.type === "string[]" ? "lista de textos" : spec.type}`);
    } else if (spec.enum && !spec.enum.includes(value as string)) {
      errors.push(`${where}: "${name}" deve ser um de ${spec.enum.join(", ")}`);
    }
  }
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.required && (props[name] === undefined || props[name] === null || props[name] === "")) {
      errors.push(`${where}: "${name}" é obrigatória`);
    }
  }
  return errors;
}
