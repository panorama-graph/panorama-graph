import { z } from "zod";
import { COMPONENT_KINDS, FACT_STATES, FACT_STATUSES, NODE_TYPE_NAMES, RELATION_TYPE_NAMES, type NodeType, type RelationType } from "../model/model";

/**
 * Forma das respostas das consultas: o contrato que os consumidores leem (o snapshot `contract/queries-v<N>.json`,
 * o OpenAPI e os tipos do SDK saem daqui). Documenta, não valida: em produção a resposta sai como a consulta a
 * monta, e são os testes que conferem cada resposta contra estes esquemas. Campo novo é compatível; renomear,
 * remover ou deixar de mandar sempre um campo é versão nova do contrato (CONTRACT_POLICY).
 */

const nodeType = z.enum(NODE_TYPE_NAMES as [NodeType, ...NodeType[]]);
const relationType = z.enum(RELATION_TYPE_NAMES as [RelationType, ...RelationType[]]);
const record = z.record(z.unknown());
const scope = z.record(z.string()).describe("Escopo do retrato (ex.: { component: example/catalog/product-api })");

export const factSchema = z
  .object({
    source: z.string().describe("Fonte que afirmou"),
    evidence: z.string().describe("Onde a fonte viu (ex.: repo@sha:caminho:linha)"),
    props: record.optional().describe("Propriedades da relação segundo esta fonte (ex.: version)"),
    status: z.enum(FACT_STATUSES).optional().describe("Em summary, só quando é stale"),
    state: z.enum(FACT_STATES).optional().describe("Em summary, só quando não é observed"),
    scope: scope.optional().describe("Só em full"),
    observedAt: z.string().optional().describe("Só em full: o último retrato que afirmou"),
    firstObservedAt: z.string().optional().describe("Só em full: o primeiro retrato que afirmou"),
  })
  .describe("Uma afirmação: quem afirmou, onde viu e, em full, o escopo e quando. Com detail summary, só o que serve para citar");

const deployedVersionField = z
  .string()
  .optional()
  .describe("Só em componentes, no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula)");

const nodeRefVersionField = z
  .string()
  .optional()
  .describe(
    "Em APIs e tópicos versionados, a versão da interface (v1, v2). Em componentes, só no recorte de um ambiente: a " +
      "versão implantada nele (no canário, mais de uma, separadas por vírgula)",
  );

export const nodeRefSchema = z
  .object({ key: z.string(), type: nodeType, name: z.string().optional(), kind: z.string().optional(), version: nodeRefVersionField })
  .describe("Ponta de uma relação: o suficiente para identificar o nó e seguir com outra consulta");

export const edgeSchema = z
  .object({
    type: relationType,
    node: nodeRefSchema,
    direction: z.enum(["out", "in"]).optional().describe("Visto do nó dono: out (dono → node) ou in (node → dono)"),
    identity: record.optional().describe("Propriedades que distinguem duas afirmações entre os mesmos nós"),
    facts: z.array(factSchema),
  })
  .describe("Relação lógica vista de um nó, com uma afirmação por fonte e escopo");

export const nodeViewSchema = z
  .object({
    key: z.string(),
    type: nodeType,
    status: z.enum(FACT_STATUSES).describe("current enquanto alguma fonte afirma o nó ou uma relação current chega nele"),
    props: record,
    referenced: z.boolean().describe("Nenhuma fonte declarou o nó: existe só como ponta de relação"),
    aliases: z.array(z.string()),
    facts: z.array(factSchema).describe("Afirmações de existência do nó"),
    version: deployedVersionField,
  })
  .describe("Nó com as próprias afirmações de existência");

export const sourceCoverageSchema = z.object({ source: z.string(), scopes: z.number(), lastObservedAt: z.string() });

export const coverageSchema = z
  .object({ what: z.string(), sources: z.array(sourceCoverageSchema), note: z.string().optional() })
  .describe("O que uma resposta vazia quer dizer: quais fontes afirmam hoje aquele tipo de fato");

export const dataUseSchema = z
  .object({
    dataset: nodeRefSchema,
    owns: z.array(factSchema).optional(),
    reads: z.array(factSchema).optional(),
    writes: z.array(factSchema).optional(),
  })
  .describe("Um dataset visto de um componente: se é dono da estrutura, se lê e se escreve");

export const dependencyFactsSchema = z
  .object({ dependent: z.array(factSchema), provider: z.array(factSchema) })
  .describe("Afirmações de quem depende (CONSUMES, CALLS, SUBSCRIBES) e de quem oferece (PROVIDES, PUBLISHES)");

const dependencyVia = z.enum(["CONSUMES", "CALLS", "SUBSCRIBES"]);
export const endpointRefSchema = z.object({ method: z.string().optional(), path: z.string().optional() });

export const dependencyEdgeSchema = z
  .object({
    from: z.string().describe("Quem depende"),
    to: z.string().describe("De quem depende"),
    via: z.object({ type: dependencyVia, node: nodeRefSchema, api: nodeRefSchema.optional(), endpoint: endpointRefSchema.optional() }),
    facts: dependencyFactsSchema,
  })
  .describe("Dependência entre componentes, derivada de CONSUMES, CALLS ou SUBSCRIBES");

export const dependencyHopSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    via: z.array(z.object({ type: dependencyVia, node: nodeRefSchema, api: nodeRefSchema.optional(), facts: dependencyFactsSchema })),
  })
  .describe("Um salto de um caminho de dependência: from depende de to, por uma ou mais vias");

export type OrgNodeShape = z.infer<typeof nodeViewSchema> & {
  parentFacts?: z.infer<typeof factSchema>[];
  level: z.infer<typeof edgeSchema>[];
  members: z.infer<typeof edgeSchema>[];
  owns: z.infer<typeof edgeSchema>[];
  groups: OrgNodeShape[];
  moreGroups?: string[];
};

export const orgNodeSchema: z.ZodType<OrgNodeShape> = z.lazy(() =>
  nodeViewSchema
    .extend({
      parentFacts: z.array(factSchema).optional().describe("Afirmações de que o grupo faz parte do pai; não vem na raiz"),
      level: z.array(edgeSchema).describe("Nível do grupo na estrutura (AT_LEVEL), com as afirmações de cada fonte; vazio quando nenhuma fonte o diz"),
      members: z.array(edgeSchema),
      owns: z.array(edgeSchema),
      groups: z.array(orgNodeSchema),
      moreGroups: z.array(z.string()).optional().describe("Subgrupos além da profundidade pedida"),
    })
    .describe("Grupo com o nível, os membros, o que possui e os subgrupos"),
);

const slim = z.object({ key: z.string(), identity: record.optional(), facts: z.array(factSchema) });
const instanceOf = z.object({ key: z.string(), name: z.string().optional(), facts: z.array(factSchema) });
const environmentRef = z
  .object({ key: z.string(), name: z.string().optional(), kind: z.string().optional(), facts: z.array(factSchema) })
  .describe("Ambiente em que o recurso está (IN_ENVIRONMENT)");
const host = z.object({
  key: z.string(),
  name: z.string().optional(),
  instanceOf: instanceOf.optional(),
  environments: z.array(environmentRef),
  facts: z.array(factSchema),
});
const counted = { count: z.number(), truncated: z.boolean() };
const environmentField = z
  .string()
  .optional()
  .describe("O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada");

export const architectureOverviewResult = z.object({
  filters: z.object({ domain: z.string().optional(), team: z.string().optional() }).optional(),
  center: z.string().optional(),
  depth: z.number().optional(),
  environment: z.string().optional().describe("O ambiente do recorte, quando `environment` foi pedido"),
  components: z.array(
    z.object({
      key: z.string(),
      name: z.string().optional(),
      kind: z.string().optional(),
      version: deployedVersionField,
      level: z.number().optional(),
      status: z.string().optional(),
      owners: z.array(slim),
      systems: z.array(
        slim.extend({
          name: z.string().optional(),
          domains: z.array(z.object({ key: z.string(), name: z.string().optional(), facts: z.array(factSchema) })),
        }),
      ),
      stack: z.array(slim),
      provides: z.array(
        z.object({
          key: z.string(),
          kind: z.string().optional(),
          endpoints: z.number(),
          contracts: z.array(z.string()),
          facts: z.array(factSchema),
        }),
      ),
      resources: z.array(
        slim.extend({
          kind: z.string().optional(),
          name: z.string().optional(),
          hostedOn: z.array(host),
          instanceOf: instanceOf.optional(),
          environments: z.array(environmentRef),
        }),
      ),
      data: z.array(dataUseSchema),
      libraries: z.number(),
    }),
  ),
  dependencies: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      via: z.array(
        z.object({
          type: dependencyVia,
          node: z.string(),
          api: z.string().optional(),
          endpoint: endpointRefSchema.optional(),
          facts: dependencyFactsSchema,
        }),
      ),
    }),
  ),
  libraryLinks: z
    .array(
      z.object({
        from: z.string().describe("Quem usa"),
        to: z.string().describe("O componente que gera a biblioteca (PRODUCES)"),
        packages: z.array(
          z.object({ key: z.string(), version: z.string().optional().describe("A versão em uso"), facts: z.array(factSchema) }),
        ),
      }),
    )
    .describe(
      "Uso direto das bibliotecas que um componente do grafo gera (um framework ou biblioteca interna com repositório), com os pacotes usados; as de terceiros ficam de fora",
    ),
  topics: z.array(
    z.object({
      key: z.string(),
      kind: z.string().optional(),
      name: z.string().optional(),
      publishers: z.array(slim),
      subscribers: z.array(slim),
      contracts: z.array(z.string()),
      hostedOn: z.array(host),
    }),
  ),
  nodes: z.object({ current: z.record(z.number()), staleHidden: z.record(z.number()).optional(), note: z.string().optional() }),
  sources: z.array(sourceCoverageSchema),
  gaps: z.array(z.string()).optional(),
  detail: z.string(),
});

export const lineRevisionSchema = z
  .object({ commit: z.string(), version: z.string().optional(), observedAt: z.string() })
  .describe("De que commit e versão é o retrato da linha principal (a visão padrão)");

export const deploymentSchema = z
  .object({
    environment: nodeRefSchema,
    version: z.string().describe("Versão em execução (rótulo)"),
    commit: z.string(),
    image: z.string().optional(),
    replicas: z.string().optional(),
    status: z.enum(FACT_STATUSES).describe("stale: a implantação saiu do ambiente (vem com includeStale, como histórico)"),
    since: z.string().describe("Primeira vez que a implantação foi vista"),
    lastSeen: z.string().describe("Última vez que a implantação foi vista"),
    frozen: z.boolean().describe("O grafo tem o retrato desta versão: o recorte do ambiente mostra o que ela oferece e usa"),
    sameAsDefault: z.boolean().nullable().describe("O commit é o da linha principal (null: a linha principal não diz de que commit é)"),
    facts: z.array(factSchema),
  })
  .describe("Uma implantação do componente (DEPLOYED_IN): ambiente, versão e commit em execução");

export const componentGetResult = z.object({
  environment: environmentField,
  component: nodeViewSchema,
  revision: lineRevisionSchema.optional(),
  deployments: z.array(deploymentSchema).describe("Onde o componente está implantado, em ordem até a produção"),
  owners: z.array(edgeSchema),
  systems: z.array(edgeSchema.extend({ domains: z.array(edgeSchema) })),
  repositories: z.array(edgeSchema),
  stack: z.array(edgeSchema),
  provides: z.array(edgeSchema.extend({ endpoints: z.array(edgeSchema) })),
  packages: z.array(edgeSchema).describe("Pacotes (bibliotecas) que o componente gera (PRODUCES), com a versão; quem usa cada um: library_usage"),
  reachesVia: z.array(edgeSchema),
  resources: z.array(
    edgeSchema.extend({
      environments: z.array(edgeSchema),
      runs: z.array(edgeSchema),
      hostedOn: z.array(edgeSchema.extend({ environments: z.array(edgeSchema), runs: z.array(edgeSchema) })),
    }),
  ),
  data: z.array(dataUseSchema),
  libraries: z.object({ count: z.number(), detail: z.string() }),
  coverage: z
    .object({
      owners: coverageSchema.optional(),
      resources: coverageSchema.optional(),
      data: coverageSchema.optional(),
      deployments: coverageSchema.optional(),
    })
    .optional()
    .describe("Vem quando falta dono, recurso, dataset ou implantação: quais fontes publicam aquele tipo de fato"),
});

export const componentsListResult = z.object({
  ...counted,
  components: z.array(
    nodeViewSchema.extend({
      owners: z.array(edgeSchema),
      matchedBy: z.array(z.object({ filter: z.string(), path: z.array(edgeSchema) })).describe("O caminho que satisfez cada filtro"),
    }),
  ),
  coverage: z.object({ owners: coverageSchema }).optional(),
});

export const interfaceVersionSchema = z
  .object({ key: z.string(), version: z.string().optional().describe("Ausente na interface sem versão") })
  .describe("Uma versão de uma API ou de um tópico (cada versão é um nó)");

const versionsField = z
  .array(interfaceVersionSchema)
  .describe("As versões da mesma interface, da sem versão e da mais antiga para a mais nova (a pedida inclusa)");

const allVersionsField = z.literal(true).optional().describe("Vem quando o resultado junta todas as versões");

export const apiConsumersResult = z.object({
  environment: environmentField,
  target: z.string(),
  versions: versionsField.optional().describe("Pedida uma API: as versões dela. Pedido o componente, não vem"),
  allVersions: allVersionsField,
  apis: z.array(z.string()),
  endpoint: z.string().optional(),
  consumers: z.array(z.object({ component: nodeRefSchema, consumes: z.array(edgeSchema), calls: z.array(edgeSchema) })),
});

export const contractGetResult = z.union([
  z
    .object({
      environment: environmentField,
      target: z.string(),
      apis: z.array(
        z.object({
          api: nodeViewSchema,
          contracts: z.array(edgeSchema),
          endpoints: z.array(
            edgeSchema.extend({
              hasContract: z.boolean().optional(),
              method: z.string().optional(),
              path: z.string().optional(),
              operationId: z.string().optional(),
              description: z.string().optional(),
            }),
          ),
        }),
      ),
      detail: z.string(),
    })
    .describe("Sem endpoint: as APIs, os contratos e os endpoints, sem o conteúdo"),
  z
    .object({
      environment: environmentField,
      target: z.string(),
      endpoint: nodeViewSchema,
      apis: z.array(edgeSchema.extend({ contracts: z.array(edgeSchema) })),
      contract: record.optional().describe("parameters, requestBody, responses e, em components, o fecho dos $ref locais"),
      coverage: z.object({ contract: z.object({ what: z.string(), note: z.string() }) }).optional(),
    })
    .describe("Com endpoint: o contrato daquela operação"),
]);

const direction = z.enum(["out", "in", "both"]);

export const componentDependenciesResult = z.union([
  z
    .object({
      environment: environmentField,
      root: z.string(),
      direction,
      depth: z.number(),
      components: z.array(nodeRefSchema.extend({ level: z.number() })),
      edges: z.array(dependencyEdgeSchema),
    })
    .describe("Sem kind: os componentes alcançados, com o nível, e as dependências entre eles"),
  z
    .object({
      environment: environmentField,
      root: z.string(),
      direction,
      depth: z.number(),
      kind: z.enum(COMPONENT_KINDS),
      components: z.array(nodeRefSchema.extend({ level: z.number(), paths: z.array(z.array(dependencyHopSchema)) })),
      coverage: z.object({ componentsOfKind: z.number(), note: z.string() }).optional(),
    })
    .describe("Com kind: só os componentes daquele tipo, com os caminhos mais curtos até a raiz"),
]);

export const topicEdgeSchema = edgeSchema
  .extend({
    topic: z.string().optional().describe("Com todas as versões: o tópico (a versão) da relação"),
    version: z.string().optional().describe("Com todas as versões: a versão do tópico da relação"),
  })
  .describe("Relação de um tópico; juntando as versões, diz de qual versão é");

export const topicGetResult = z.object({
  environment: environmentField,
  topic: nodeViewSchema,
  versions: versionsField,
  allVersions: allVersionsField,
  publishers: z.array(topicEdgeSchema),
  subscribers: z.array(topicEdgeSchema),
  contracts: z.array(topicEdgeSchema),
  hostedOn: z.array(topicEdgeSchema),
});

export const datasetGetResult = z.object({
  environment: environmentField,
  dataset: nodeViewSchema,
  owners: z.array(edgeSchema),
  readers: z.array(edgeSchema),
  writers: z.array(edgeSchema),
});

export const orgStructureResult = z.object({
  depth: z.number(),
  levels: z
    .array(nodeViewSchema)
    .describe("Níveis citados pelos grupos da resposta (OrgLevel), de cima para baixo: `order` é a posição e `team` diz se os grupos do nível são times"),
  groups: z.array(orgNodeSchema),
  coverage: coverageSchema.optional(),
});

export const peopleListResult = z.object({
  ...counted,
  people: z.array(nodeViewSchema.extend({ memberships: z.array(edgeSchema) })),
  coverage: coverageSchema.optional(),
});

export const libraryUseSchema = edgeSchema
  .extend({
    direct: z.boolean().describe("Direta (o componente declara a biblioteca) ou transitiva (chega por outra)"),
    version: z.string().optional().describe("Versão em uso: a resolvida pelo build, quando alguma fonte a dá"),
    unused: z.literal(true).optional().describe("Declarada no build e não usada pelo código"),
    via: z.array(z.string()).optional().describe("Na transitiva: as dependências diretas (chaves) que a trazem"),
    library: z.string().optional().describe("Consultado um componente: o pacote dele de que este uso depende"),
  })
  .describe("Uso de uma biblioteca por um componente (DEPENDS_ON), com o resumo das afirmações");

export const libraryUsageResult = z.object({
  environment: environmentField,
  library: nodeViewSchema.describe("A biblioteca consultada, ou o componente, quando é ele o consultado"),
  packages: z
    .array(edgeSchema)
    .optional()
    .describe("Consultado um componente: os pacotes que o build dele gera (PRODUCES), cujos usos vêm em users"),
  producedBy: z.array(edgeSchema).optional().describe("Consultada uma biblioteca: o componente cujo build a gera"),
  versionRange: z.string().optional(),
  direct: z.boolean().optional(),
  versions: z
    .array(z.object({ version: z.string().nullable(), components: z.array(z.string()) }))
    .describe("Versões em uso, da mais nova para a mais antiga (null: sem versão afirmada), com os componentes"),
  users: z.array(libraryUseSchema),
});

export const componentLibrariesResult = z.object({
  environment: environmentField,
  component: nodeViewSchema,
  counts: z.object({ direct: z.number(), transitive: z.number(), unused: z.number() }),
  libraries: z.array(libraryUseSchema),
  coverage: coverageSchema.optional().describe("Vem quando o componente não tem biblioteca: quais fontes publicam bibliotecas"),
});

export const routeGetResult = z.object({
  environment: environmentField,
  host: z.string(),
  path: z.string().optional(),
  routes: z.array(
    z.object({
      entry: nodeRefSchema,
      host: z.string(),
      path: z.string().nullable(),
      to: nodeRefSchema,
      facts: z.array(factSchema),
      provides: z.array(edgeSchema),
    }),
  ),
});

export const nodesFindResult = z.object({
  ...counted,
  nodes: z.array(nodeRefSchema.extend({ status: z.enum(FACT_STATUSES), referenced: z.boolean(), matchedAlias: z.string().optional() })),
});

export const nodeGetResult = z.object({
  node: nodeViewSchema,
  relations: z.array(
    z.object({
      type: relationType,
      direction: z.enum(["out", "in"]),
      description: z.string(),
      total: z.number(),
      truncated: z.boolean().optional(),
      edges: z.array(edgeSchema),
    }),
  ),
});

const outcomeCounts = z.object({
  created: z.number().optional(),
  updated: z.number().optional(),
  unchanged: z.number().optional(),
  stale: z.number().optional(),
});
export const loadCountsSchema = z
  .object({ nodes: outcomeCounts.optional(), relations: outcomeCounts.optional(), referenced: z.number().optional() })
  .describe("Contagens de uma carga (numa aposentadoria, só stale)");

export const sourcesStatusResult = z.object({
  sources: z.array(
    z.object({
      source: z.string(),
      lastObservedAt: z.string(),
      scopes: z.array(
        z.object({
          scope,
          lastObservedAt: z.string(),
          receivedAt: z.string().optional(),
          counts: loadCountsSchema.optional(),
          retired: z.object({ by: z.string(), reason: z.string() }).optional(),
          revision: z
            .object({ component: z.string(), commit: z.string(), version: z.string().optional(), frozen: z.boolean() })
            .optional()
            .describe("De que versão de um componente é o retrato; frozen: retrato congelado daquele commit"),
          producer: z
            .object({ name: z.string(), version: z.string() })
            .optional()
            .describe("Quem montou o último retrato do escopo, e em que versão (quando o produtor informa)"),
        }),
      ),
      scopeCount: z.number(),
    }),
  ),
  loads: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      scope,
      observedAt: z.string(),
      receivedAt: z.string(),
      counts: loadCountsSchema,
      retired: z.object({ by: z.string(), reason: z.string(), evidence: z.string() }).optional(),
    }),
  ),
  coverage: z.array(coverageSchema.extend({ kind: z.string() })),
});

export const factDivergencesResult = z.object({
  ...counted,
  divergences: z.array(
    z.object({
      kind: z.enum(["props", "targets"]),
      type: relationType,
      from: nodeRefSchema,
      props: z.array(z.string()).optional().describe("Em props: as propriedades em disputa"),
      edges: z.array(edgeSchema),
    }),
  ),
});

const compareChanges = z.object({
  added: z.array(nodeRefSchema),
  removed: z.array(nodeRefSchema),
  changed: z
    .array(z.object({ node: nodeRefSchema, from: z.string().optional(), to: z.string().optional() }))
    .describe("Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo)"),
});
const compareSide = z.object({
  line: z.boolean().optional().describe("Este lado é a linha principal"),
  environment: z.string().optional(),
  version: z.string().optional(),
  commit: z.string().optional(),
  frozen: z.boolean().optional().describe("No ambiente: o grafo tem o retrato da versão implantada"),
  note: z.string().optional().describe("Quando o lado pedido não pôde ser montado com a versão implantada"),
});

export const componentCompareResult = z.object({
  component: z.string(),
  from: compareSide,
  to: compareSide,
  same: z.boolean().describe("Nada mudou nas categorias comparadas"),
  changes: z
    .object({
      endpoints: compareChanges.optional(),
      consumes: compareChanges.optional(),
      calls: compareChanges.optional(),
      publishes: compareChanges.optional(),
      subscribes: compareChanges.optional(),
      owns: compareChanges.optional(),
      reads: compareChanges.optional(),
      writes: compareChanges.optional(),
      resources: compareChanges.optional(),
      libraries: compareChanges.optional(),
      stack: compareChanges.optional(),
    })
    .describe("Só as categorias com mudança"),
});

export const graphQueryResult = z.object({
  columns: z.array(z.string()),
  rows: z.array(record),
  truncated: z.boolean(),
  truncatedBy: z.enum(["rows", "size"]).optional(),
  note: z.string().optional(),
});

/** Formas compartilhadas, com nome próprio no contrato (viram `$ref` e um tipo do SDK cada). */
export const SHARED_SCHEMAS = {
  Fact: factSchema,
  NodeRef: nodeRefSchema,
  Edge: edgeSchema,
  NodeView: nodeViewSchema,
  Coverage: coverageSchema,
  SourceCoverage: sourceCoverageSchema,
  DataUse: dataUseSchema,
  DependencyFacts: dependencyFactsSchema,
  DependencyEdge: dependencyEdgeSchema,
  DependencyHop: dependencyHopSchema,
  Deployment: deploymentSchema,
  LineRevision: lineRevisionSchema,
  EndpointRef: endpointRefSchema,
  OrgNode: orgNodeSchema,
  LoadCounts: loadCountsSchema,
  LibraryUse: libraryUseSchema,
  InterfaceVersion: interfaceVersionSchema,
  TopicEdge: topicEdgeSchema,
} satisfies Record<string, z.ZodTypeAny>;
