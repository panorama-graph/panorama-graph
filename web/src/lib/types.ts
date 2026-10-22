/**
 * Formas das respostas das consultas do grafo (`POST /v1/queries/<ferramenta>`), como a API as devolve com
 * `detail: "full"`. Vêm do SDK (`@panorama-graph/sdk`), gerado do contrato da API; aqui ficam só os nomes que
 * as telas usam para as partes de cada resposta.
 */
import type {
  ApiConsumersResult,
  ArchitectureOverviewResult,
  ComponentCompareResult,
  ComponentDependenciesResult,
  ComponentGetResult,
  ComponentLibrariesResult,
  ComponentsListResult,
  ContractGetResult,
  DatasetGetResult,
  FactDivergencesResult,
  LibraryUsageResult,
  NodeGetResult,
  NodesFindResult,
  OrgStructureResult,
  SourcesStatusResult,
  TopicGetResult,
} from "@panorama-graph/sdk";

export type {
  Coverage,
  DataUse,
  DependencyEdge,
  DependencyFacts,
  DependencyHop,
  Edge,
  EndpointRef,
  Fact,
  LibraryUse,
  LoadCounts,
  NodeRef,
  NodeView,
  OrgNode,
} from "@panorama-graph/sdk";

export type Overview = ArchitectureOverviewResult;
export type OverviewComponent = Overview["components"][number];
export type OverviewDependency = Overview["dependencies"][number];
export type OverviewVia = OverviewDependency["via"][number];
export type Slim = OverviewComponent["owners"][number];
export type OverviewSystem = OverviewComponent["systems"][number];
export type OverviewResource = OverviewComponent["resources"][number];
/** Instância em que o recurso ou o tópico está (`HOSTED_ON`), com o componente de infraestrutura dela. */
export type OverviewHost = OverviewResource["hostedOn"][number];
/** Componente de infraestrutura de que uma instância é a implantação no ambiente (`INSTANCE_OF`). */
export type InstanceOf = NonNullable<OverviewResource["instanceOf"]>;

export type Dependencies = ComponentDependenciesResult;
/** Com `kind`: só os componentes daquele tipo, com os caminhos; sem: o grafo de dependências. */
export type DependenciesOfKind = Extract<Dependencies, { kind: string }>;
export type DependencyGraph = Exclude<Dependencies, DependenciesOfKind>;
export type ComponentGet = ComponentGetResult;
/** Uma implantação do componente (DEPLOYED_IN): ambiente, versão, commit e se o grafo tem o retrato dela. */
export type Deployment = ComponentGet["deployments"][number];
export type ComponentCompare = ComponentCompareResult;
export type ComponentsList = ComponentsListResult;
export type ApiConsumers = ApiConsumersResult;

/** Sem endpoint: as APIs, os contratos e os endpoints; com endpoint: o contrato daquela operação. */
export type ContractList = Extract<ContractGetResult, { detail: string }>;
export type ContractOne = Exclude<ContractGetResult, ContractList>;
export type ContractEndpoint = ContractList["apis"][number]["endpoints"][number];

export type TopicGet = TopicGetResult;
export type DatasetGet = DatasetGetResult;
export type LibraryUsage = LibraryUsageResult;
export type ComponentLibraries = ComponentLibrariesResult;
export type OrgStructure = OrgStructureResult;

export type NodesFind = NodesFindResult;
export type FoundNode = NodesFind["nodes"][number];

export type NodeGet = NodeGetResult;
export type RelationGroup = NodeGet["relations"][number];

export type SourcesStatus = SourcesStatusResult;
export type ScopeStatus = SourcesStatus["sources"][number]["scopes"][number];

export type FactDivergences = FactDivergencesResult;
export type Divergence = FactDivergences["divergences"][number];
