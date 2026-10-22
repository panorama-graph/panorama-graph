import { z } from "zod";
import type { GraphDb } from "../db/neo4j";
import { COMPONENT_KINDS, NODE_TYPE_NAMES, RELATION_TYPE_NAMES, type NodeType, type RelationType } from "../model/model";
import type { QueryService } from "./QueryService";
import { summarize } from "./brief";
import * as R from "./responses";
import type { Deprecation, Stability } from "./contract";
import { GRAPH_QUERY_LIMITS, runReadOnly } from "./graphQuery";

export const PROVENANCE_NOTE =
  "Cada relação vem com `facts`: uma afirmação por fonte, com source, scope, state (observed, inferred, confirmed), " +
  "status (current, stale), evidence e observedAt. Cite a fonte ao responder. Fontes que discordam aparecem lado a lado. " +
  "A relação vista de um nó traz `direction`: out (do nó para `node`) ou in (de `node` para o nó); cite-a nesse sentido.";

const NODE_NOTE =
  "Nós trazem `status`: current enquanto alguma fonte afirma o nó ou uma relação current chega nele, stale quando " +
  "todas deixaram de afirmar (ex.: nome antigo de um serviço renomeado). `referenced: true` quer dizer que nenhuma " +
  "fonte declarou o nó: ele existe só como ponta de uma relação (ex.: biblioteca citada no SBOM).";

const ref = (what: string) => z.string().min(1).describe(`${what}: chave, apelido, nome ou último segmento da chave`);
const detail = (fallback: "summary" | "full") =>
  z
    .enum(["summary", "full"])
    .optional()
    .describe(
      `summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); ` +
        `full: com scope, observedAt e firstObservedAt. Padrão: ${fallback}`,
    );

export const ENVIRONMENT_NOTE =
  "Sem `environment`, a resposta é o retrato da linha principal (o código mais recente publicado, que pode ainda não " +
  "estar em execução). Com `environment`, cada componente implantado naquele ambiente aparece na versão em execução " +
  "(`version` na ponta do componente), com o que essa versão oferece e usa; use-o para perguntas sobre o que roda " +
  "num ambiente (ex.: impacto em produção). Componente sem implantação conhecida no ambiente segue a linha principal.";

const environment = ref("Ambiente (ex.: env:prd): o retrato das versões implantadas nele").optional();

const includeStale = z
  .boolean()
  .optional()
  .describe("Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez");

type Detail = "summary" | "full";

/**
 * Uma consulta de leitura, servida igual pelo MCP (`tools/call`) e pelo REST (`POST /queries/<name>`): o mesmo
 * nome, os mesmos argumentos e a mesma resposta. Assim uma consulta citada por um agente pode ser refeita por
 * qualquer consumidor.
 */
export type QueryTool = {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** Forma da resposta (com detail full; em summary, as afirmações vêm resumidas). Ver `responses.ts`. */
  output: z.ZodTypeAny;
  /** Forma das afirmações quando `detail` não vem. Ferramentas sem `detail` no schema devolvem tudo. */
  defaultDetail: Detail;
  /** Recebe os argumentos já validados pelo inputSchema, sem o `detail`. */
  execute: (args: any) => Promise<unknown>;
  /** Versão do contrato em que a ferramenta entrou (padrão 1). */
  since?: number;
  /** exploratory: fora do contrato (padrão stable). Ver CONTRACT_POLICY em contract.ts. */
  stability?: Stability;
  /** Obsoleta: continua servida até sair numa versão seguinte do contrato; `use` é a substituta. */
  deprecated?: Deprecation;
  /** Argumentos obsoletos, com o substituto de cada um. */
  deprecatedArgs?: Record<string, Deprecation>;
};

/** A descrição publicada no MCP e no REST: com o aviso, quando a ferramenta é obsoleta. */
export function toolDescription(tool: QueryTool): string {
  if (!tool.deprecated) return tool.description;
  const { since, use } = tool.deprecated;
  return `Obsoleta desde a versão ${since} do contrato das consultas: use ${use}. ${tool.description}`;
}

/** Executa a consulta e aplica o `detail` (resumo das afirmações em `summary`). */
export async function runQueryTool(tool: QueryTool, args: Record<string, unknown>): Promise<unknown> {
  const { detail: requested, ...rest } = args as { detail?: Detail };
  const result = await tool.execute(rest);
  return (requested ?? tool.defaultDetail) === "summary" ? summarize(result) : result;
}

/** As consultas de leitura do grafo. Todas rodam em transação de leitura. */
export function queryTools(queries: QueryService, db: GraphDb): QueryTool[] {
  return [
    {
      name: "architecture_overview",
      description:
        "Retrato da arquitetura numa chamada: componentes (dono, sistema e o domínio dele, stack, APIs com contagem de endpoints e " +
        "contratos, recursos com o tipo, o ambiente, a instância em que estão (banco → servidor, com o ambiente dela) e o componente de infraestrutura de que a instância é implantação, datasets que mapeia, lê e escreve, contagem de bibliotecas), dependências entre componentes (por API, endpoint, com o método e o caminho, ou tópico), " +
        "tópicos com quem publica, quem assina e o broker em que estão (com o componente de infraestrutura dele), contagem de nós por tipo (e dos stale ocultos), fontes carregadas e " +
        "`gaps`: o que nenhuma fonte cobre ainda. Bibliotecas vêm só como contagem, exceto as que um componente do grafo gera (um framework " +
        "ou biblioteca interna com repositório): `libraryLinks` liga quem as usa diretamente a esse componente, com o pacote e a versão. Três recortes: nenhum (a " +
        "organização inteira); `domain` ou `team` (os componentes do recorte e as dependências que entram ou saem " +
        "dele); `component` (a vizinhança técnica: o componente, de quem ele depende e quem depende dele até `depth` " +
        `níveis, com o \`level\` de cada um e as dependências entre todos da vizinhança). Com \`environment\`, só os ` +
        `recursos daquele ambiente (o do recurso ou o da instância em que ele está), em qualquer recorte, e os componentes ` +
        `na versão implantada nele. ${ENVIRONMENT_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        domain: ref("Domínio").optional(),
        team: ref("Grupo dono").optional(),
        component: ref("Componente no centro da vizinhança (não combina com domain nem team)").optional(),
        depth: z.number().int().min(1).max(5).optional().describe("Níveis da vizinhança de `component` (padrão 1, máximo 5)"),
        environment: ref("Ambiente (ex.: env:prd): só os recursos e as instâncias dele, e os componentes na versão implantada").optional(),
        includeStale,
        detail: detail("summary"),
      },
      output: R.architectureOverviewResult,
      defaultDetail: "summary",
      execute: (args) => queries.architectureOverview(args),
    },
    {
      name: "component_get",
      description:
        "Um componente: dono, sistema e domínio, repositório, stack (tecnologias e versões), APIs oferecidas com os endpoints, " +
        "`packages`: os pacotes que ele gera (num framework ou biblioteca interna; quem usa cada um: library_usage), " +
        `gateways por onde sai, recursos usados até a instância e o motor (banco → servidor → tecnologia e versão), com o ` +
        "ambiente do recurso e o da instância (`environments`), e " +
        "`data`: os datasets (coleções, tabelas) de que ele é dono da estrutura (`owns`), que lê (`reads`) e em que " +
        "escreve (`writes`), lidos do código no build. `revision`: de que commit e versão é o retrato da linha principal. " +
        "`deployments`: onde o componente roda, uma implantação por ambiente e commit, com a versão, desde quando, " +
        "`sameAsDefault` (é o commit da linha principal) e `frozen` (o grafo tem o retrato daquela versão); com " +
        "includeStale, também as que saíram (histórico). Para ver o que mudou entre a linha principal e um ambiente, " +
        "use component_compare. Sem dono, recurso, dataset ou implantação, vem `coverage` daquele tipo de fato. " +
        "O contrato de cada endpoint vem pelo contract_get. " +
        `${ENVIRONMENT_NOTE} ${NODE_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: { component: ref("Componente"), environment, includeStale, detail: detail("full") },
      output: R.componentGetResult,
      defaultDetail: "full",
      execute: ({ component, ...opts }) => queries.componentGet(component, opts),
    },
    {
      name: "components_list",
      description:
        "Lista componentes com o dono de cada um, e filtros combináveis: domínio (pelo sistema), time dono (inclui subgrupos), kind, e " +
        "tecnologia (pela stack do componente ou pelo motor do banco que ele usa). Cada componente traz `matchedBy`: " +
        "o caminho que satisfez cada filtro, com as afirmações. Só os nós: para as relações entre eles, use " +
        `architecture_overview. ${NODE_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        domain: ref("Domínio").optional(),
        team: ref("Grupo dono").optional(),
        kind: z.enum(COMPONENT_KINDS).optional(),
        technology: ref("Tecnologia (ex.: spring-boot, postgresql)").optional(),
        includeStale,
        detail: detail("summary"),
      },
      output: R.componentsListResult,
      defaultDetail: "summary",
      execute: (args) => queries.componentsList(args),
    },
    {
      name: "api_consumers",
      description:
        "Quem consome uma API: CONSUMES (dependência declarada) e CALLS (endpoints chamados), por consumidor. " +
        "Aceita a API ou o componente que a oferece. Com `endpoint`, só quem chama aquele endpoint. " +
        "Uma API versionada é uma API por versão (`version` na ponta: api:<serviço>/v1/http e api:<serviço>/v2/http): " +
        "para saber quem consome uma versão, passe a API daquela versão; com o componente, vêm todas, cada consumidor " +
        "na versão que chama. A versão exposta na infraestrutura (serviço servico-xpto-v2, ligado à API do código por " +
        "VERSION_OF) traz os endpoints da API do código, chamados por quem consome aquela versão. Pedida uma API, " +
        "`versions` lista as versões dela; com `allVersions`, vêm os consumidores de todas (\"quem usa a API X, em " +
        `qualquer versão?\"). ${ENVIRONMENT_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        target: ref("API (de uma versão, quando versionada) ou componente que a oferece"),
        allVersions: z.boolean().optional().describe("Com uma API: os consumidores de todas as versões dela"),
        endpoint: z
          .string()
          .min(1)
          .optional()
          .describe('Endpoint: chave, "MÉTODO /caminho" (ex.: "GET /products/{id}") ou operationId'),
        environment,
        includeStale,
        detail: detail("full"),
      },
      output: R.apiConsumersResult,
      defaultDetail: "full",
      execute: ({ target, ...opts }) => queries.apiConsumers(target, opts),
    },
    {
      name: "contract_get",
      description:
        "Contrato de uma API HTTP. Aceita a API ou o componente que a oferece. Sem `endpoint`: as APIs, os " +
        "contratos que as especificam (SPECIFIED_BY) e os endpoints, cada um com `hasContract`, sem o conteúdo. " +
        "Com `endpoint`: o contrato daquela operação (`contract`: parameters, requestBody, responses e, em " +
        "`components`, o fecho dos $ref locais: schemas, parameters, responses, requestBodies), com a " +
        "evidência no documento. Endpoint sem contrato vem com `coverage`: sem dados, não que não existe. " +
        `${ENVIRONMENT_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        target: ref("API ou componente que a oferece"),
        endpoint: z
          .string()
          .min(1)
          .optional()
          .describe('Endpoint: chave, "MÉTODO /caminho" (ex.: "POST /orders") ou operationId'),
        environment,
        includeStale,
        detail: detail("summary"),
      },
      output: R.contractGetResult,
      defaultDetail: "summary",
      execute: ({ target, ...opts }) => queries.contractGet(target, opts),
    },
    {
      name: "component_dependencies",
      description:
        "Dependências lógicas entre componentes: A depende de B se consome uma API de B, chama um endpoint dela, ou " +
        "assina um tópico que B publica. direction `out` = de que depende, `in` = quem depende dele. Com `kind`, " +
        "o resultado são só os componentes daquele tipo, cada um com os caminhos mais curtos até o componente, no " +
        "sentido da dependência (ex.: \"quais frontends dependem de X\": direction in, kind frontend, depth 3 para " +
        "passar por BFFs). O percurso atravessa componentes de qualquer tipo. Rotas físicas " +
        `(gateway, ingress) não entram: use route_get. ${ENVIRONMENT_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        component: ref("Componente"),
        direction: z.enum(["out", "in", "both"]).optional().describe("Padrão: out"),
        depth: z.number().int().min(1).max(5).optional().describe("Níveis transitivos (padrão 1, máximo 5)"),
        kind: z.enum(COMPONENT_KINDS).optional().describe("Só componentes deste tipo, com os caminhos"),
        environment,
        includeStale,
        detail: detail("full"),
      },
      output: R.componentDependenciesResult,
      defaultDetail: "full",
      execute: ({ component, kind, ...opts }) =>
        kind
          ? queries.componentDependenciesOfKind(component, { ...opts, kind })
          : queries.componentDependencies(component, opts),
    },
    {
      name: "component_compare",
      description:
        "O que mudou num componente entre dois retratos: `from` e `to` são ambientes (a versão implantada em cada um) " +
        "ou, omitidos, a linha principal (ex.: \"o que está em produção e já saiu do código?\": from env:prd, sem to). " +
        "Por categoria, o que entrou (`added`), o que saiu (`removed`) e o que mudou (`changed`: versão de " +
        "biblioteca direta ou de tecnologia; contrato de endpoint, sem o conteúdo): endpoints oferecidos, APIs " +
        "consumidas, endpoints chamados, tópicos publicados e assinados, datasets (dono, leitura, escrita), recursos " +
        "usados, bibliotecas diretas e stack. Cada lado diz o ambiente, a versão e o commit; um lado sem o retrato " +
        "da versão implantada vem com `note` e é a linha principal. Para o contrato de um endpoint que mudou, use " +
        "contract_get com o environment de cada lado.",
      inputSchema: {
        component: ref("Componente"),
        from: ref("Ambiente do lado de origem (omitido: a linha principal)").optional(),
        to: ref("Ambiente do lado de destino (omitido: a linha principal)").optional(),
      },
      output: R.componentCompareResult,
      defaultDetail: "full",
      execute: ({ component, from, to }) => queries.componentCompare(component, { from, to }),
    },
    {
      name: "topic_get",
      description:
        "Um tópico de eventos: quem publica, quem assina, o contrato e o broker. Cada versão de um tópico é um tópico, " +
        "com o próprio nome (product-created.v1, product-created.v2) e a versão em `version`: quem assina uma versão " +
        "é quem assina aquele tópico. `versions` lista as versões do mesmo tópico. Com `allVersions`, ou passando o " +
        "nome sem a versão (product-created), vêm as relações de todas as versões, cada uma com `topic` e `version` " +
        `("quem usa o evento Y, em qualquer versão?"). ${ENVIRONMENT_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        topic: ref("Tópico (de uma versão) ou o nome sem a versão"),
        allVersions: z.boolean().optional().describe("As relações de todas as versões do tópico"),
        environment,
        includeStale,
        detail: detail("full"),
      },
      output: R.topicGetResult,
      defaultDetail: "full",
      execute: ({ topic, ...opts }) => queries.topicGet(topic, opts),
    },
    {
      name: "dataset_get",
      description:
        "Um dataset (coleção ou tabela): o componente dono da estrutura (OWNS_DATA, quem tem o mapeamento), quem lê " +
        "(READS) e quem escreve (WRITES), com a linha do código como evidência. O dataset é identificado pelo " +
        "componente que o mapeia (dataset:<componente>/<nome>), não pelo banco: dois serviços com a mesma coleção " +
        `física aparecem como datasets distintos. ${ENVIRONMENT_NOTE} ${NODE_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: { dataset: ref("Dataset (ex.: products)"), environment, includeStale, detail: detail("full") },
      output: R.datasetGetResult,
      defaultDetail: "full",
      execute: ({ dataset, ...opts }) => queries.datasetGet(dataset, opts),
    },
    {
      name: "org_structure",
      description:
        "Estrutura organizacional: árvore de grupos, membros (com papel, e `lead` em quem lidera o grupo) e o que cada " +
        "grupo possui. Cada grupo traz o `level` (AT_LEVEL: diretoria, tribo, time, no vocabulário da organização), e " +
        "`levels` traz esses níveis em ordem, com `team` nos que são times. Cada subgrupo traz `parentFacts`, as " +
        "afirmações de que faz parte do pai. Sem `group`, parte dos grupos raiz. Vazio vem com `coverage`, que diz se " +
        "alguma fonte publica a estrutura. " +
        PROVENANCE_NOTE,
      inputSchema: {
        group: ref("Grupo").optional(),
        depth: z.number().int().min(0).max(5).optional().describe("Níveis de subgrupos (padrão 2)"),
        includeStale,
        detail: detail("full"),
      },
      output: R.orgStructureResult,
      defaultDetail: "full",
      execute: (args) => queries.orgStructure(args),
    },
    {
      name: "people_list",
      description:
        "Pessoas, em ordem de nome, cada uma com os grupos de que faz parte (`memberships`: MEMBER_OF, com papel e " +
        "`lead` em cada afirmação). `group` deixa só os membros diretos do grupo; `text` filtra pelo nome ou pela " +
        "chave. Para a árvore dos grupos, use org_structure. Vazio vem com `coverage`, que diz se alguma fonte " +
        `publica a estrutura. ${NODE_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        group: ref("Só os membros diretos deste grupo").optional(),
        text: z.string().optional().describe("Texto procurado no nome ou na chave da pessoa"),
        limit: z.number().int().min(1).max(500).optional().describe("Máximo de pessoas (padrão 200)"),
        includeStale,
        detail: detail("full"),
      },
      output: R.peopleListResult,
      defaultDetail: "full",
      execute: (args) => queries.peopleList(args),
    },
    {
      name: "library_usage",
      description:
        "Quem depende de uma biblioteca e em que versão. Cada uso diz se é direto (`direct`: o componente declara a " +
        "biblioteca) ou transitivo (chega por outra; `via` traz as dependências diretas que a trazem, o que atualizar), " +
        "a `version` em uso (a resolvida pelo build, quando há) e `unused` quando é declarada e o código não usa. " +
        "`versions` resume as versões em uso, da mais nova para a mais antiga, com os componentes de cada uma (ex.: " +
        "\"quantas versões do Spring Boot convivem?\"). `versionRange` filtra, ex.: \"<3.2.0\" ou \">=2.0 <3.0\"; " +
        `\`direct\` fica só com os usos diretos (true) ou só com os transitivos (false). Aceita também o componente que ` +
        "gera bibliotecas (ex.: um framework interno com vários módulos): valem todos os pacotes que o build dele gera " +
        "(`packages`), e cada uso diz o pacote em `library`. Consultada uma biblioteca, `producedBy` diz de que componente " +
        `ela sai. ${ENVIRONMENT_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        library: ref("Biblioteca (ex.: lib:maven/org.springframework.boot:spring-boot) ou o componente que gera bibliotecas"),
        versionRange: z.string().min(1).optional(),
        direct: z.boolean().optional().describe("true: só quem usa diretamente; false: só quem recebe por outra biblioteca"),
        environment,
        includeStale,
        detail: detail("full"),
      },
      output: R.libraryUsageResult,
      defaultDetail: "full",
      execute: ({ library, ...opts }) => queries.libraryUsage(library, opts),
    },
    {
      name: "component_libraries",
      description:
        "As bibliotecas de um componente, com a `version` em uso (a resolvida pelo build, quando há). Por padrão só " +
        "as diretas (as que o componente declara); `transitive` traz também as que chegam por outra, cada uma com " +
        "`via`: as dependências diretas que a trazem. `unused` marca (e, como argumento, filtra) as declaradas que o " +
        "código não usa, candidatas a limpeza. `counts` diz quantas são diretas, transitivas e sem uso. Para quem " +
        `usa uma biblioteca, use library_usage. ${ENVIRONMENT_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        component: ref("Componente"),
        transitive: z.boolean().optional().describe("Inclui as transitivas (padrão: só as diretas)"),
        unused: z.boolean().optional().describe("Só as declaradas que o código não usa"),
        environment,
        includeStale,
        detail: detail("summary"),
      },
      output: R.componentLibrariesResult,
      defaultDetail: "summary",
      execute: ({ component, ...opts }) => queries.componentLibraries(component, opts),
    },
    {
      name: "route_get",
      description:
        "Por onde passa uma requisição: o gateway ou ingress que atende o host, o componente a que chega e as APIs " +
        `dele. Com \`path\`, fica a rota de prefixo mais longo. ${ENVIRONMENT_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: {
        host: z.string().min(1).describe("Host da requisição (ex.: product-api.dev.example.com)"),
        path: z.string().startsWith("/").optional().describe("Caminho da requisição"),
        environment,
        includeStale,
        detail: detail("full"),
      },
      output: R.routeGetResult,
      defaultDetail: "full",
      execute: ({ host, ...opts }) => queries.routeGet(host, opts),
    },
    {
      name: "nodes_find",
      description:
        "Acha nós de qualquer tipo pelo texto contido no nome, na chave ou num apelido (sem diferenciar maiúsculas). " +
        "Busca por texto, não por significado: para \"quais componentes cuidam de X\", prefira components_list e " +
        "architecture_overview. Ordem: nome igual ao texto, último segmento da chave igual, nome começando por ele; no " +
        "empate, componentes primeiro. " +
        "Sem `text`, lista os nós dos `types`. Com `referencedOnly`, só os nós que nenhuma fonte declarou (pontas " +
        `de relação, ex.: biblioteca citada no SBOM ou apelido faltando). ${NODE_NOTE}`,
      inputSchema: {
        text: z.string().optional().describe("Texto procurado no nome, na chave ou num apelido"),
        types: z.array(z.enum(NODE_TYPE_NAMES as [NodeType, ...NodeType[]])).optional().describe("Só nós destes tipos"),
        referencedOnly: z.boolean().optional().describe("Só nós que nenhuma fonte declarou"),
        limit: z.number().int().min(1).max(500).optional().describe("Máximo de nós (padrão 50)"),
        includeStale,
      },
      output: R.nodesFindResult,
      defaultDetail: "full",
      execute: (args) => queries.nodesFind(args),
    },
    {
      name: "node_get",
      description:
        "Um nó de qualquer tipo com as afirmações de existência e todas as relações, agrupadas por tipo e direção " +
        "(out: do nó para `node`; in: de `node` para o nó). Cada grupo traz até 100 relações e o `total`. Para " +
        "componentes, APIs, tópicos, datasets, bibliotecas e grupos, as ferramentas próprias respondem melhor; " +
        `esta serve para os demais (sistema, domínio, recurso, pessoa, tecnologia, repositório, contrato). ${NODE_NOTE} ${PROVENANCE_NOTE}`,
      inputSchema: { node: ref("Nó"), includeStale, detail: detail("full") },
      output: R.nodeGetResult,
      defaultDetail: "full",
      execute: ({ node, includeStale }) => queries.nodeGet(node, { includeStale }),
    },
    {
      name: "sources_status",
      description:
        "De onde vêm os fatos: por fonte, os escopos carregados, com a data e as contagens do último retrato " +
        "(criados, alterados, inalterados, que viraram stale) e quem aposentou o escopo, se for o caso; as cargas " +
        "mais recentes; e, para cada tipo de fato que responde perguntas comuns (donos, organização, sistemas, " +
        "recursos, rotas, dados), quais fontes o publicam hoje. Tipo sem fonte quer dizer sem dados, não que não existe.",
      inputSchema: {
        source: z.string().min(1).optional().describe("Só esta fonte"),
        limit: z.number().int().min(1).max(500).optional().describe("Máximo de cargas recentes (padrão 50)"),
      },
      output: R.sourcesStatusResult,
      defaultDetail: "full",
      execute: (args) => queries.sourcesStatus(args),
    },
    {
      name: "fact_divergences",
      description:
        "Onde as fontes discordam, no retrato atual. `kind: props`: a mesma relação com valores diferentes na mesma " +
        "propriedade (ex.: versão do framework segundo o SBOM e segundo o CI), com as propriedades em disputa em " +
        "`props`. `kind: targets`: relação que devia ter um alvo só (OWNED_BY, PART_OF, HOSTED_IN) com mais de um " +
        `alvo. Cada item traz as afirmações de todas as fontes, lado a lado. ${PROVENANCE_NOTE}`,
      inputSchema: {
        relationType: z.enum(RELATION_TYPE_NAMES as [RelationType, ...RelationType[]]).optional().describe("Só este tipo de relação"),
        node: ref("Só as relações que saem deste nó ou chegam nele").optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Máximo de itens (padrão 200)"),
        detail: detail("full"),
      },
      output: R.factDivergencesResult,
      defaultDetail: "full",
      execute: ({ relationType, node, limit }) => queries.factDivergences({ relationType, node, limit }),
    },
    {
      name: "graph_query",
      description:
        "Cypher só de leitura, para explorar o que nenhuma outra ferramenta cobre (para a visão geral, use architecture_overview). " +
        "A forma como o grafo guarda os fatos (labels, propriedades, :Claim) não é contrato e pode mudar: um sistema que " +
        "consulta o grafo sempre deve usar as outras ferramentas, e o que nenhuma delas responde vira ferramenta nova. " +
        "Nós do modelo têm o label :Node e o do tipo (ex.: :Node:Component), a propriedade `key` e `status` " +
        "(current ou stale, derivado das afirmações). Relações têm a proveniência nas propriedades (source, " +
        "scopeKey, state, status, evidence, observedAt). Para o retrato atual, filtre n.status = 'current' nos nós e " +
        "r.status = 'current' nas relações, e devolva source e evidence para poder citar. As DEPENDS_ON para :Library " +
        "são a maioria das relações: exclua (WHERE NOT b:Library) ou agregue (count) quando não for sobre bibliotecas. " +
        `Limites: ${GRAPH_QUERY_LIMITS.timeoutMs} ms, ${GRAPH_QUERY_LIMITS.maxRows} linhas e ` +
        `${GRAPH_QUERY_LIMITS.maxChars} caracteres de resultado; ao cortar, vem truncated, truncatedBy e note. LOAD CSV é recusado.`,
      inputSchema: {
        cypher: z.string().min(1),
        params: z.record(z.unknown()).optional().describe("Parâmetros ($nome) da consulta"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(GRAPH_QUERY_LIMITS.maxRows)
          .optional()
          .describe(`Máximo de linhas (padrão ${GRAPH_QUERY_LIMITS.defaultRows})`),
      },
      output: R.graphQueryResult,
      defaultDetail: "full",
      stability: "exploratory",
      execute: ({ cypher, params, limit }) => runReadOnly(db, cypher, params ?? {}, { limit }),
    },
  ];
}
