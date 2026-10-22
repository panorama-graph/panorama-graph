import type { ManagedTransaction } from "neo4j-driver";
import type { GraphDb } from "../db/neo4j";
import { ApiError } from "../errors";
import {
  NODE_TYPE_NAMES,
  NODE_TYPES,
  RELATION_TYPE_NAMES,
  RELATION_TYPES,
  relationSpec,
  type NodeType,
  type RelationType,
} from "../model/model";
import {
  groupEdges,
  mergeFacts,
  nodeRef,
  relFact,
  toFact,
  toNodeRef,
  type Edge,
  type Fact,
  type NodeRef,
  type RelRow,
} from "./facts";
import { resolveRef } from "./resolveRef";
import { familyMembers, familyOf, topicFamily, type InterfaceVersion } from "./families";
import { libraryUse, versionsInUse } from "./libraries";
import { parseRange, satisfies } from "./versions";
import { deployedVersion, live, liveNode, resolveView, stampVersions, visible, visParams, type Vis, type ViewOpt } from "./view";

/**
 * Todas as consultas aceitam as afirmações `stale` sob pedido e o recorte de um ambiente (`environment`): sem ele,
 * o retrato da linha principal; com ele, o das versões implantadas ali. Ver `view.ts`.
 */
export type StaleOpt = ViewOpt;

/**
 * Nó com as próprias afirmações de existência. `status`: `current` enquanto alguma fonte afirma o nó ou uma
 * relação current chega nele; `stale` quando todas deixaram de afirmar. `referenced`: alguma relação apontou
 * para ele, nenhuma fonte o declarou (ele existe só como ponta).
 */
export type NodeView = {
  key: string;
  type: string;
  status: string;
  props: Record<string, unknown>;
  referenced: boolean;
  aliases: string[];
  facts: Fact[];
};

/** Um passo de um caminho: a relação seguida, o nó a que ela chega e as afirmações dela. */
export type Hop = Edge;

export type DependencyEdge = {
  /** `from` depende de `to`. */
  from: string;
  to: string;
  /**
   * Como: CONSUMES (pela API), CALLS (pelo endpoint) ou SUBSCRIBES (pelo tópico que `to` publica). Em CALLS, `api` é
   * a API de `to` que tem o endpoint (HAS_ENDPOINT) e `endpoint`, o método e o caminho dele.
   */
  via: { type: "CONSUMES" | "CALLS" | "SUBSCRIBES"; node: NodeRef; api?: NodeRef; endpoint?: { method?: string; path?: string } };
  /** Afirmações da ponta de quem depende (CONSUMES, CALLS, SUBSCRIBES) e da de quem oferece (PROVIDES, PUBLISHES). */
  facts: { dependent: Fact[]; provider: Fact[] };
};

/** Um dataset visto de um componente: se ele é dono da estrutura, se lê e se escreve, cada um com as afirmações. */
export type DataUse = {
  dataset: NodeRef;
  owns?: Fact[];
  reads?: Fact[];
  writes?: Fact[];
};

/**
 * `parentFacts`: as afirmações de que o grupo faz parte do pai (PART_OF); não vem na raiz. `level`: o nível do grupo
 * na estrutura (AT_LEVEL), um por fonte que o afirma.
 */
export type OrgNode = NodeView & {
  parentFacts?: Fact[];
  level: Edge[];
  members: Edge[];
  owns: Edge[];
  groups: OrgNode[];
  moreGroups?: string[];
};

/** Um escopo carregado por uma fonte, com o último retrato. */
export type ScopeStatus = {
  scope: Record<string, string>;
  lastObservedAt: string;
  receivedAt?: string;
  counts?: Record<string, unknown>;
  retired?: { by: string; reason: string };
  /** De que versão de um componente é o retrato do escopo; `frozen`: retrato congelado daquele commit. */
  revision?: { component: string; commit: string; version?: string; frozen: boolean };
  /** Quem montou o último retrato do escopo, e em que versão. */
  producer?: { name: string; version: string };
};

/**
 * Fontes que discordam. `props`: a mesma relação, com valores diferentes em `props` (as propriedades em
 * disputa). `targets`: uma relação de alvo único com mais de um alvo, um Edge por alvo.
 */
export type Divergence = {
  kind: "props" | "targets";
  type: RelationType;
  from: NodeRef;
  props?: string[];
  edges: Edge[];
};

const NODE_META = new Set(["key", "type", "createdAt", "status"]);
const MAX_DEPTH = 5;
const MAX_LIST = 500;
const MAX_EDGES_PER_GROUP = 100;

/**
 * Relações que deviam ter um alvo só, a partir destes tipos de nó: um componente tem um dono, um sistema e um
 * repositório. Mais de um alvo vigente é divergência entre fontes (ou dentro de uma), não modelagem.
 */
const SINGLE_TARGET: [RelationType, NodeType[]][] = [
  ["OWNED_BY", ["Component", "System", "Domain", "Api"]],
  ["PART_OF", ["Component", "System", "Group"]],
  ["HOSTED_IN", ["Component"]],
];

/** Propriedades a que as afirmações dão valores diferentes. Afirmação que não fala da propriedade não conta. */
function divergentProps(facts: Fact[]): string[] {
  const values = new Map<string, Set<string>>();
  for (const f of facts) {
    for (const [p, v] of Object.entries(f.props ?? {})) {
      values.set(p, (values.get(p) ?? new Set()).add(JSON.stringify(v)));
    }
  }
  return [...values].filter(([, vs]) => vs.size > 1).map(([p]) => p).sort();
}

const parseScope = (scopeKey: unknown): Record<string, string> =>
  scopeKey ? (JSON.parse(scopeKey as string) as Record<string, string>) : {};

type Dir = "out" | "in";

/**
 * Consultas de leitura sobre o grafo, cada uma numa transação de leitura. Toda relação devolvida
 * traz as afirmações com a proveniência (Fact); os tipos no Cypher vêm só do modelo.
 */
export class QueryService {
  constructor(private readonly db: GraphDb) {}

  /** Componente com dono, sistema e domínio, repositório, stack, APIs oferecidas, pacotes gerados, gateways e recursos até o motor. */
  componentGet(ref: string, opts: StaleOpt = {}) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const { key } = await resolveRef(tx, ref, ["Component"]);
      const [node, owners, systems, repositories, stack, provides, packages, reachesVia, resources, data, deployed, revision] = await Promise.all([
        nodeView(tx, key, s),
        edges(tx, key, "OWNED_BY", "out", s),
        edges(tx, key, "PART_OF", "out", s),
        edges(tx, key, "HOSTED_IN", "out", s),
        edges(tx, key, "BUILT_WITH", "out", s),
        edges(tx, key, "PROVIDES", "out", s),
        edges(tx, key, "PRODUCES", "out", s),
        edges(tx, key, "REACHES_VIA", "out", s),
        edges(tx, key, "USES_RESOURCE", "out", s),
        dataUseOf(tx, [key], s),
        edges(tx, key, "DEPLOYED_IN", "out", s),
        lineRevision(tx, key),
      ]);
      const domains = await edgesOf(tx, systems.map((e) => e.node.key), "PART_OF", "out", s);
      const hosts = await edgesOf(tx, resources.map((e) => e.node.key), "HOSTED_ON", "out", s);
      const instances = [...resources.map((e) => e.node.key), ...[...hosts.values()].flat().map((e) => e.node.key)];
      const [runs, environments] = await Promise.all([
        edgesOf(tx, instances, "RUNS", "out", s),
        edgesOf(tx, instances, "IN_ENVIRONMENT", "out", s),
      ]);
      const endpoints = await edgesOf(tx, provides.map((e) => e.node.key), "HAS_ENDPOINT", "out", s);

      const libs = await tx.run(
        `MATCH (:Node {key: $key})-[r:DEPENDS_ON]->(l:Node) WHERE ${live("r")} RETURN count(DISTINCT l) AS n`,
        { key, ...visParams(s) },
      );

      return stampVersions({
        ...(s.environment ? { environment: s.environment } : {}),
        component: node,
        ...(revision ? { revision } : {}),
        deployments: await deploymentsOf(tx, key, deployed, revision),
        owners,
        systems: systems.map((e) => ({ ...e, domains: domains.get(e.node.key) ?? [] })),
        repositories,
        stack,
        provides: provides.map((e) => ({ ...e, endpoints: endpoints.get(e.node.key) ?? [] })),
        packages,
        reachesVia,
        resources: resources.map((e) => ({
          ...e,
          environments: environments.get(e.node.key) ?? [],
          runs: runs.get(e.node.key) ?? [],
          hostedOn: (hosts.get(e.node.key) ?? []).map((h) => ({
            ...h,
            environments: environments.get(h.node.key) ?? [],
            runs: runs.get(h.node.key) ?? [],
          })),
        })),
        data: data.get(key) ?? [],
        libraries: { count: libs.records[0].get("n") as number, detail: "use component_libraries para as bibliotecas e versões do componente" },
        ...(owners.length === 0 || resources.length === 0 || !data.has(key) || deployed.length === 0
          ? {
              coverage: {
                ...(owners.length === 0 ? { owners: await coverage(tx, "owners") } : {}),
                ...(resources.length === 0 ? { resources: await coverage(tx, "resources") } : {}),
                ...(!data.has(key) ? { data: await coverage(tx, "data") } : {}),
                ...(deployed.length === 0 ? { deployments: await coverage(tx, "deployments") } : {}),
              },
            }
          : {}),
      }, s);
    });
  }

  /**
   * Componentes filtrados, cada um com o dono. Cada filtro devolve o caminho que o satisfez, com as afirmações:
   * domínio por System→Domain, time por OWNED_BY (inclui subgrupos), tecnologia por BUILT_WITH
   * ou pelo recurso usado (USES_RESOURCE → HOSTED_ON → RUNS).
   */
  componentsList(filters: { domain?: string; team?: string; kind?: string; technology?: string } & StaleOpt) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, filters);
      const matches: Map<string, { filter: string; path: Hop[] }[]>[] = [];

      if (filters.domain) {
        const { key } = await resolveRef(tx, filters.domain, ["Domain"]);
        matches.push(
          await paths(
            tx,
            "domain",
            `MATCH (c:Component)-[r1:PART_OF]->(sys:System)-[r2:PART_OF]->(d:Node {key: $target})
             WHERE ${live("r1")} AND ${live("r2")}
             RETURN c.key AS c, [{type: 'PART_OF', node: ${nodeRef("sys")}, rel: properties(r1)},
                                 {type: 'PART_OF', node: ${nodeRef("d")}, rel: properties(r2)}] AS hops`,
            { target: key, ...visParams(s) },
          ),
        );
      }
      if (filters.team) {
        const { key } = await resolveRef(tx, filters.team, ["Group"]);
        matches.push(
          await paths(
            tx,
            "team",
            `MATCH p = (g:Group)-[:PART_OF*0..${MAX_DEPTH}]->(t:Node {key: $target})
             WHERE all(x IN relationships(p) WHERE ${live("x")})
             MATCH (c:Component)-[r:OWNED_BY]->(g) WHERE ${live("r")}
             RETURN c.key AS c,
                    [{type: 'OWNED_BY', node: ${nodeRef("g")}, rel: properties(r)}] +
                    [x IN relationships(p) | {type: 'PART_OF', node: ${nodeRef("endNode(x)")}, rel: properties(x)}] AS hops`,
            { target: key, ...visParams(s) },
          ),
        );
      }
      if (filters.technology) {
        const { key } = await resolveRef(tx, filters.technology, ["Technology"]);
        matches.push(
          await paths(
            tx,
            "technology",
            `CALL {
               MATCH (c:Component)-[r:BUILT_WITH]->(t:Node {key: $target}) WHERE ${live("r")}
               RETURN c, [{type: 'BUILT_WITH', node: ${nodeRef("t")}, rel: properties(r)}] AS hops
               UNION ALL
               MATCH (c:Component)-[u:USES_RESOURCE]->(res:Resource)-[x:RUNS]->(t:Node {key: $target})
               WHERE ${live("u")} AND ${live("x")}
               RETURN c, [{type: 'USES_RESOURCE', node: ${nodeRef("res")}, rel: properties(u)},
                          {type: 'RUNS', node: ${nodeRef("t")}, rel: properties(x)}] AS hops
               UNION ALL
               MATCH (c:Component)-[u:USES_RESOURCE]->(res:Resource)-[h:HOSTED_ON]->(i:Resource)-[x:RUNS]->(t:Node {key: $target})
               WHERE ${live("u")} AND ${live("h")} AND ${live("x")}
               RETURN c, [{type: 'USES_RESOURCE', node: ${nodeRef("res")}, rel: properties(u)},
                          {type: 'HOSTED_ON', node: ${nodeRef("i")}, rel: properties(h)},
                          {type: 'RUNS', node: ${nodeRef("t")}, rel: properties(x)}] AS hops
             }
             RETURN c.key AS c, hops`,
            { target: key, ...visParams(s) },
          ),
        );
      }

      let keys: string[];
      if (matches.length > 0) {
        keys = [...matches[0].keys()].filter((k) => matches.every((m) => m.has(k)));
      } else {
        const all = await tx.run(
          `MATCH (c:Component) WHERE ${liveNode("c", s)} RETURN c.key AS key ORDER BY key LIMIT ${MAX_LIST + 1}`,
          { ...visParams(s) },
        );
        keys = all.records.map((r) => r.get("key") as string);
      }

      const [views, owners] = await Promise.all([nodeViews(tx, keys, s), edgesOf(tx, keys, "OWNED_BY", "out", s)]);
      const components = views
        .filter((v) => !filters.kind || v.props.kind === filters.kind)
        .map((v) => ({ ...v, owners: owners.get(v.key) ?? [], matchedBy: matches.flatMap((m) => m.get(v.key) ?? []) }))
        .sort((a, b) => a.key.localeCompare(b.key));
      const noOwner = components.some((c) => c.owners.length === 0);
      return {
        count: Math.min(components.length, MAX_LIST),
        truncated: components.length > MAX_LIST,
        components: components.slice(0, MAX_LIST),
        ...(noOwner ? { coverage: { owners: await coverage(tx, "owners") } } : {}),
      };
    });
  }

  /**
   * Quem consome uma API: CONSUMES na API e CALLS nos endpoints dela. `ref` pode ser a API ou o componente
   * que a oferece (vale para todas as APIs dele). `endpoint` restringe às chamadas a um endpoint.
   *
   * Versão na infraestrutura (VERSION_OF): a API exposta com a versão no nome (`servico-xpto-v2`) não tem endpoints
   * próprios, e sim os da API do código. Pedida a versão, vêm os endpoints da API do código, chamados por quem consome
   * aquela versão; pedida a API do código (ou o componente), vêm também os consumidores de cada versão exposta.
   *
   * Pedida uma API, `versions` traz as versões da mesma API (a família, ver `families.ts`); com `allVersions`, os
   * consumidores de todas elas, cada um na versão que consome.
   */
  apiConsumers(ref: string, opts: { endpoint?: string; allVersions?: boolean } & StaleOpt = {}) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const target = await resolveRef(tx, ref, ["Api", "Component"]);
      const family = target.type === "Api" ? familyOf(target.key) : null;
      const versions: InterfaceVersion[] | undefined = family ? await familyMembers(tx, family, s, target.key) : undefined;
      const all = !!opts.allVersions && target.type === "Api";
      const base =
        target.type === "Api"
          ? all && versions
            ? versions.map((v) => v.key)
            : [target.key]
          : (await edges(tx, target.key, "PROVIDES", "out", s)).map((e) => e.node.key);
      const linked = async (dir: Dir) => [...(await edgesOf(tx, base, "VERSION_OF", dir, s)).values()].flat().map((e) => e.node.key);
      const exposedAs = await linked("in");
      const codeApis = await linked("out");
      const apis = [...new Set([...base, ...exposedAs])];
      const withEndpoints = [...new Set([...base, ...codeApis])];
      // A versão exposta pedida sozinha: só as chamadas de quem a consome, e não as das outras versões.
      const onlyConsumersOf = target.type === "Api" && !all && codeApis.length > 0 ? [target.key] : null;

      let endpointKey: string | null = null;
      if (opts.endpoint) endpointKey = await this.resolveEndpoint(tx, opts.endpoint, withEndpoints, s);

      const consumes = endpointKey
        ? []
        : (
            await tx.run(
            `UNWIND $apis AS a
             MATCH (c:Component)-[r:CONSUMES]->(api:Node {key: a}) WHERE ${live("r")}
             RETURN ${nodeRef("c")} AS consumer, 'CONSUMES' AS type, ${nodeRef("api")} AS node, properties(r) AS rel`,
            { apis, ...visParams(s) },
          )
          ).records;
      const calls = await tx.run(
        `UNWIND $apis AS a
         MATCH (:Node {key: a})-[h:HAS_ENDPOINT]->(e:Endpoint)<-[r:CALLS]-(c:Component)
         WHERE ${live("h")} AND ${live("r")} AND ($endpoint IS NULL OR e.key = $endpoint)
           AND ($consumersOf IS NULL OR exists {
             MATCH (c)-[k:CONSUMES]->(v:Node) WHERE v.key IN $consumersOf AND ${live("k")}
           })
         RETURN ${nodeRef("c")} AS consumer, 'CALLS' AS type, ${nodeRef("e")} AS node, properties(r) AS rel`,
        { apis: withEndpoints, endpoint: endpointKey, consumersOf: onlyConsumersOf, ...visParams(s) },
      );

      const byConsumer = new Map<string, { component: NodeRef; rows: RelRow[] }>();
      for (const r of [...consumes, ...calls.records]) {
        const consumer = r.get("consumer") as Record<string, unknown>;
        const k = consumer.key as string;
        if (!byConsumer.has(k)) byConsumer.set(k, { component: toNodeRef(consumer), rows: [] });
        byConsumer.get(k)!.rows.push({ type: r.get("type"), node: r.get("node"), rel: r.get("rel") });
      }
      const consumers = [...byConsumer.values()]
        .sort((a, b) => a.component.key.localeCompare(b.component.key))
        .map(({ component, rows }) => {
          const grouped = groupEdges(rows, "out");
          return {
            component,
            consumes: grouped.filter((e) => e.type === "CONSUMES"),
            calls: grouped.filter((e) => e.type === "CALLS"),
          };
        });
      return stampVersions({
        ...(s.environment ? { environment: s.environment } : {}),
        target: target.key,
        ...(versions ? { versions } : {}),
        ...(all ? { allVersions: true as const } : {}),
        apis,
        ...(endpointKey ? { endpoint: endpointKey } : {}),
        consumers,
      }, s);
    });
  }

  /**
   * Contrato de uma API. `ref` pode ser a API ou o componente que a oferece. Sem `endpoint`: as APIs com os
   * contratos (SPECIFIED_BY) e os endpoints, sem o conteúdo, cada um dizendo se tem contrato. Com `endpoint`:
   * o contrato daquela operação (parâmetros, corpo, respostas e schemas), com as afirmações de HAS_ENDPOINT.
   */
  contractGet(ref: string, opts: { endpoint?: string } & StaleOpt = {}) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const target = await resolveRef(tx, ref, ["Api", "Component"]);
      const apis =
        target.type === "Api"
          ? [target.key]
          : (await edges(tx, target.key, "PROVIDES", "out", s)).map((e) => e.node.key);

      if (opts.endpoint) {
        const key = await this.resolveEndpoint(tx, opts.endpoint, apis, s);
        const [view, declaredBy] = await Promise.all([nodeView(tx, key, s), edges(tx, key, "HAS_ENDPOINT", "in", s)]);
        const { contract: raw, ...props } = view.props;
        const contracts = await edgesOf(tx, declaredBy.map((e) => e.node.key), "SPECIFIED_BY", "out", s);
        return {
          ...(s.environment ? { environment: s.environment } : {}),
          target: target.key,
          endpoint: { ...view, props },
          apis: declaredBy.map((e) => ({ ...e, contracts: contracts.get(e.node.key) ?? [] })),
          ...(typeof raw === "string"
            ? { contract: JSON.parse(raw) as unknown }
            : {
                coverage: {
                  contract: {
                    what: "contrato do endpoint (parâmetros, corpo, respostas)",
                    note:
                      "Nenhuma fonte publicou o contrato deste endpoint (ex.: ele só aparece nas chamadas de quem o " +
                      "consome). Vazio aqui quer dizer sem dados, não que não existe.",
                  },
                },
              }),
        };
      }

      const [apiViews, contracts, endpoints] = await Promise.all([
        nodeViews(tx, apis, s),
        edgesOf(tx, apis, "SPECIFIED_BY", "out", s),
        edgesOf(tx, apis, "HAS_ENDPOINT", "out", s),
      ]);
      // As propriedades vêm do retrato da consulta: no recorte de um ambiente, as da versão implantada.
      const endpointKeys = [...endpoints.values()].flat().map((e) => e.node.key);
      const byKey = new Map((await nodeViews(tx, endpointKeys, s)).map((v) => [v.key, v.props]));
      const detail = (key: string) => {
        const p = byKey.get(key);
        if (!p) return {};
        const out: Record<string, unknown> = { hasContract: typeof p.contract === "string" };
        for (const k of ["method", "path", "operationId", "description"]) if (p[k] != null) out[k] = p[k];
        return out;
      };
      return {
        ...(s.environment ? { environment: s.environment } : {}),
        target: target.key,
        apis: apiViews.map((api) => ({
          api,
          contracts: contracts.get(api.key) ?? [],
          endpoints: (endpoints.get(api.key) ?? []).map((e) => ({ ...e, ...detail(e.node.key) })),
        })),
        detail: "o conteúdo do contrato vem por endpoint: chame de novo com endpoint (chave ou \"MÉTODO /caminho\").",
      };
    });
  }

  /**
   * Dependências entre componentes, derivadas das relações lógicas: A depende de B quando A consome
   * uma API de B, chama um endpoint de uma API de B, ou assina um tópico que B publica.
   * `out`: de que o componente depende; `in`: quem depende dele. Percorre até `depth` níveis.
   */
  componentDependencies(ref: string, opts: { direction?: "out" | "in" | "both"; depth?: number } & StaleOpt = {}) {
    const direction = opts.direction ?? "out";
    const depth = Math.min(Math.max(opts.depth ?? 1, 1), MAX_DEPTH);
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const { key: root } = await resolveRef(tx, ref, ["Component"]);
      const t = await traverse(tx, root, direction === "both" ? ["out", "in"] : [direction], depth, s);
      const refs = await nodeRefs(tx, [...t.levels.keys()]);
      return stampVersions({
        ...(s.environment ? { environment: s.environment } : {}), 
        root,
        direction,
        depth,
        components: [...t.levels].map(([key, level]) => ({ ...refs.get(key)!, level })),
        edges: [...t.edges.values()],
      }, s);
    });
  }

  /**
   * O mesmo percurso, mas o resultado são só os componentes de um `kind` (ex.: os frontends que dependem de X),
   * cada um com os caminhos mais curtos até a raiz no sentido da dependência (frontend → bff → serviço).
   * O percurso passa por componentes de qualquer tipo. Vazio vem com a cobertura daquele kind no grafo.
   */
  componentDependenciesOfKind(
    ref: string,
    opts: { kind: string; direction?: "out" | "in" | "both"; depth?: number } & StaleOpt,
  ) {
    const direction = opts.direction ?? "out";
    const depth = Math.min(Math.max(opts.depth ?? 1, 1), MAX_DEPTH);
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const { key: root } = await resolveRef(tx, ref, ["Component"]);
      const t = await traverse(tx, root, direction === "both" ? ["out", "in"] : [direction], depth, s);
      const refs = await nodeRefs(tx, [...t.levels.keys()]);
      const components = [...t.levels]
        .filter(([key]) => key !== root && refs.get(key)!.kind === opts.kind)
        .map(([key, level]) => ({ ...refs.get(key)!, level, paths: t.paths(key) }));

      let coverage: { componentsOfKind: number; note: string } | undefined;
      if (components.length === 0) {
        const res = await tx.run(
          `MATCH (c:Component) WHERE c.kind = $kind AND ${liveNode("c", s)} RETURN count(c) AS n`,
          { kind: opts.kind, ...visParams(s) },
        );
        const n = res.records[0].get("n") as number;
        coverage = {
          componentsOfKind: n,
          note:
            n === 0
              ? `Nenhum componente com kind "${opts.kind}" foi publicado no grafo. Vazio aqui quer dizer sem dados, não que não existe.`
              : `Há ${n} componente(s) "${opts.kind}" no grafo, mas nenhum ligado a ${root} em até ${depth} nível(is) nesta direção.`,
        };
      }
      return stampVersions({ ...(s.environment ? { environment: s.environment } : {}), root, direction, depth, kind: opts.kind, components, ...(coverage ? { coverage } : {}) }, s);
    });
  }

  /**
   * Tópico com quem publica, quem assina, o contrato e o broker, e as versões do mesmo tópico (`versions`: cada
   * versão é um tópico, com a versão no fim do nome). Com `allVersions`, ou pedido o nome sem a versão
   * (`product-created`) quando só existem as versionadas, as relações de todas as versões, cada uma com `topic` e
   * `version`; `topic` é então a versão mais nova.
   */
  topicGet(ref: string, opts: { allVersions?: boolean } & StaleOpt = {}) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      let key: string;
      let all = !!opts.allVersions;
      try {
        key = (await resolveRef(tx, ref, ["Topic"])).key;
      } catch (err) {
        const name = ref.replace(/^topic:/, "");
        const isFamilyName = !/[-.]v\d+$/i.test(name);
        if (!(err instanceof ApiError) || err.statusCode !== 404 || !isFamilyName) throw err;
        const members = await familyMembers(tx, topicFamily(name), s);
        if (members.length === 0) throw err;
        key = members[members.length - 1].key;
        all = true;
      }
      const versions = await familyMembers(tx, topicFamily(key.slice("topic:".length)), s, key);
      const keys = all ? versions.map((v) => v.key) : [key];
      const versionOf = new Map(versions.map((v) => [v.key, v.version]));
      const tagged = async (type: RelationType, dir: Dir): Promise<(Edge & { topic?: string; version?: string })[]> => {
        const byTopic = await edgesOf(tx, keys, type, dir, s);
        if (!all) return byTopic.get(key) ?? [];
        return keys.flatMap((k) =>
          (byTopic.get(k) ?? []).map((e) => ({ ...e, topic: k, ...(versionOf.get(k) ? { version: versionOf.get(k) } : {}) })),
        );
      };
      const [topic, publishers, subscribers, contracts, hostedOn] = await Promise.all([
        nodeView(tx, key, s),
        tagged("PUBLISHES", "in"),
        tagged("SUBSCRIBES", "in"),
        tagged("SPECIFIED_BY", "out"),
        tagged("HOSTED_ON", "out"),
      ]);
      return stampVersions({
        ...(s.environment ? { environment: s.environment } : {}),
        topic,
        versions,
        ...(all ? { allVersions: true as const } : {}),
        publishers,
        subscribers,
        contracts,
        hostedOn,
      }, s);
    });
  }

  /** Dataset com o componente dono da estrutura (OWNS_DATA), quem lê (READS) e quem escreve (WRITES). */
  datasetGet(ref: string, opts: StaleOpt = {}) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const { key } = await resolveRef(tx, ref, ["Dataset"]);
      const [dataset, owners, readers, writers] = await Promise.all([
        nodeView(tx, key, s),
        edges(tx, key, "OWNS_DATA", "in", s),
        edges(tx, key, "READS", "in", s),
        edges(tx, key, "WRITES", "in", s),
      ]);
      return stampVersions({ ...(s.environment ? { environment: s.environment } : {}), dataset, owners, readers, writers }, s);
    });
  }

  /**
   * Árvore de grupos (PART_OF entre grupos), com o nível de cada um, os membros e o que possui. Sem grupo: parte das
   * raízes. `levels` são os níveis citados pelos grupos da resposta, em ordem.
   */
  orgStructure(opts: { group?: string; depth?: number } & StaleOpt = {}) {
    const depth = Math.min(Math.max(opts.depth ?? 2, 0), MAX_DEPTH);
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      let roots: string[];
      if (opts.group) {
        roots = [(await resolveRef(tx, opts.group, ["Group"])).key];
      } else {
        const res = await tx.run(
          `MATCH (g:Group) WHERE ${liveNode("g", s)} AND NOT exists { MATCH (g)-[r:PART_OF]->(:Group) WHERE ${live("r")} }
           RETURN g.key AS key ORDER BY key LIMIT ${MAX_LIST}`,
          { ...visParams(s) },
        );
        roots = res.records.map((r) => r.get("key") as string);
      }
      const groups = await this.orgLevel(tx, roots, depth, s, new Set());
      // Os níveis citados pelos grupos da resposta, de cima para baixo: nome, posição e se são times.
      const levelKeys = new Set<string>();
      const collect = (gs: OrgNode[]): void => gs.forEach((g) => (g.level.forEach((e) => levelKeys.add(e.node.key)), collect(g.groups)));
      collect(groups);
      const levels = (await nodeViews(tx, [...levelKeys], s)).sort(
        (a, b) => ((a.props.order as number | undefined) ?? Infinity) - ((b.props.order as number | undefined) ?? Infinity) || a.key.localeCompare(b.key),
      );
      return { depth, levels, groups, ...(groups.length === 0 ? { coverage: await coverage(tx, "org") } : {}) };
    });
  }

  private async orgLevel(
    tx: ManagedTransaction,
    keys: string[],
    depth: number,
    s: Vis,
    seen: Set<string>,
    parentFacts: Map<string, Fact[]> = new Map(),
  ): Promise<OrgNode[]> {
    const fresh = keys.filter((k) => !seen.has(k));
    fresh.forEach((k) => seen.add(k));
    if (fresh.length === 0) return [];
    const [views, levels, members, owns, children] = await Promise.all([
      nodeViews(tx, fresh, s),
      edgesOf(tx, fresh, "AT_LEVEL", "out", s),
      edgesOf(tx, fresh, "MEMBER_OF", "in", s),
      edgesOf(tx, fresh, "OWNED_BY", "in", s),
      edgesOf(tx, fresh, "PART_OF", "in", s),
    ]);
    const out: OrgNode[] = [];
    for (const v of views) {
      const sub = (children.get(v.key) ?? []).filter((e) => e.node.type === "Group");
      const facts = parentFacts.get(v.key);
      out.push({
        ...v,
        ...(facts ? { parentFacts: facts } : {}),
        level: levels.get(v.key) ?? [],
        members: members.get(v.key) ?? [],
        owns: owns.get(v.key) ?? [],
        groups: depth > 0 ? await this.orgLevel(tx, sub.map((e) => e.node.key), depth - 1, s, seen, new Map(sub.map((e) => [e.node.key, e.facts]))) : [],
        ...(depth === 0 && sub.length > 0 ? { moreGroups: sub.map((e) => e.node.key) } : {}),
      });
    }
    return out;
  }

  /**
   * Pessoas com os grupos de que fazem parte (MEMBER_OF, com papel e `lead` em cada afirmação), em ordem de nome.
   * `group` deixa só os membros diretos do grupo; `text` filtra pelo nome ou pela chave.
   */
  peopleList(opts: { group?: string; text?: string; limit?: number } & StaleOpt = {}) {
    const text = (opts.text ?? "").trim().toLowerCase();
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), MAX_LIST);
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const group = opts.group ? (await resolveRef(tx, opts.group, ["Group"])).key : null;
      const res = await tx.run(
        `MATCH (p:Person) WHERE ${liveNode("p", s)}
           AND ($text = '' OR toLower(p.key) CONTAINS $text OR toLower(coalesce(p.name, '')) CONTAINS $text)
           AND ($group IS NULL OR exists { MATCH (p)-[r:MEMBER_OF]->(:Group {key: $group}) WHERE ${live("r")} })
         RETURN p.key AS key ORDER BY toLower(coalesce(p.name, p.key)), p.key LIMIT ${limit + 1}`,
        { text, group, ...visParams(s) },
      );
      const all = res.records.map((r) => r.get("key") as string);
      const page = all.slice(0, limit);
      const [views, memberships] = await Promise.all([nodeViews(tx, page, s), edgesOf(tx, page, "MEMBER_OF", "out", s)]);
      const byKey = new Map(views.map((v) => [v.key, v]));
      const people = page.map((k) => ({ ...byKey.get(k)!, memberships: memberships.get(k) ?? [] }));
      return {
        count: people.length,
        truncated: all.length > limit,
        people,
        ...(people.length === 0 ? { coverage: await coverage(tx, "org") } : {}),
      };
    });
  }

  /**
   * Quem depende da biblioteca e em que versão. Com um componente, vale para os pacotes que ele gera (`packages`),
   * e cada uso diz o pacote (`library`); com uma biblioteca, `producedBy` diz de que componente ela sai. `versionRange` filtra as afirmações (ex.: "<3.2.0"); `direct`
   * fica só com quem a usa diretamente (true) ou só com quem a recebe por outra (false). `versions` resume as
   * versões em uso, com os componentes de cada uma.
   */
  libraryUsage(ref: string, opts: { versionRange?: string; direct?: boolean } & StaleOpt = {}) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const range = opts.versionRange ? parseRange(opts.versionRange) : null;
      const { key, type } = await resolveRef(tx, ref, ["Library", "Component"]);
      // Um componente vale pelos pacotes que o build dele gera (PRODUCES): os usos de todos, cada um com o pacote.
      const component = type === "Component";
      const [library, produced] = await Promise.all([nodeView(tx, key, s), edges(tx, key, "PRODUCES", component ? "out" : "in", s)]);
      const packages = component ? produced.map((e) => e.node.key) : [key];
      const byPackage = await edgesOf(tx, packages, "DEPENDS_ON", "in", s);
      const users: (Edge & { library?: string })[] = packages
        .flatMap((p) => (byPackage.get(p) ?? []).map((e): Edge & { library?: string } => (component ? { ...e, library: p } : e)))
        .sort((a, b) => a.node.key.localeCompare(b.node.key) || (a.library ?? "").localeCompare(b.library ?? ""));
      const inRange = range
        ? users
            .map((e) => ({
              ...e,
              facts: e.facts.filter((f) => {
                const v = f.props?.version;
                return typeof v === "string" && satisfies(v, range);
              }),
            }))
            .filter((e) => e.facts.length > 0)
        : users;
      const uses = inRange.map(libraryUse).filter((u) => opts.direct === undefined || u.direct === opts.direct);
      return stampVersions(
        {
          ...(s.environment ? { environment: s.environment } : {}),
          library,
          packages: component ? produced : undefined,
          producedBy: !component && produced.length ? produced : undefined,
          ...(opts.versionRange ? { versionRange: opts.versionRange } : {}),
          ...(opts.direct !== undefined ? { direct: opts.direct } : {}),
          versions: versionsInUse(uses),
          users: uses,
        },
        s,
      );
    });
  }

  /**
   * As bibliotecas de um componente: por padrão só as diretas; `transitive` traz também as que chegam por outra
   * (com `via`, as diretas que as trazem). `unused` fica só com as declaradas que o código não usa.
   */
  componentLibraries(ref: string, opts: { transitive?: boolean; unused?: boolean } & StaleOpt = {}) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const { key } = await resolveRef(tx, ref, ["Component"]);
      const [component, all] = await Promise.all([nodeView(tx, key, s), edges(tx, key, "DEPENDS_ON", "out", s)]);
      const uses = all.map(libraryUse).sort((a, b) => a.node.key.localeCompare(b.node.key));
      const libraries = uses.filter((u) => (opts.transitive || u.direct) && (!opts.unused || u.unused));
      return stampVersions(
        {
          ...(s.environment ? { environment: s.environment } : {}),
          component,
          counts: {
            direct: uses.filter((u) => u.direct).length,
            transitive: uses.filter((u) => !u.direct).length,
            unused: uses.filter((u) => u.unused).length,
          },
          libraries,
          ...(all.length === 0 ? { coverage: await coverage(tx, "libraries") } : {}),
        },
        s,
      );
    });
  }

  /**
   * Por onde passa uma requisição: as rotas (ROUTES) de gateways e ingresses para o host. Com `path`,
   * fica a rota de prefixo mais longo que o casa. Traz o componente de destino e as APIs que ele oferece.
   */
  routeGet(host: string, opts: { path?: string } & StaleOpt = {}) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const res = await tx.run(
        `MATCH (entry:Resource)-[r:ROUTES]->(c:Component)
         WHERE toLower(r.host) = toLower($host) AND ${live("r")}
         RETURN ${nodeRef("entry")} AS entry, ${nodeRef("c")} AS node, properties(r) AS rel`,
        { host: host.trim(), ...visParams(s) },
      );
      type Route = { entry: NodeRef; host: string; path: string | null; to: NodeRef; facts: Fact[] };
      const byId = new Map<string, Route>();
      for (const r of res.records) {
        const rel = r.get("rel") as Record<string, unknown>;
        const entry = toNodeRef(r.get("entry"));
        const to = toNodeRef(r.get("node"));
        const path = (rel.path as string | undefined) ?? null;
        const id = JSON.stringify([entry.key, to.key, rel.host, path]);
        if (!byId.has(id)) byId.set(id, { entry, host: rel.host as string, path, to, facts: [] });
        byId.get(id)!.facts.push(relFact("ROUTES", rel));
      }

      let routes = [...byId.values()];
      if (opts.path !== undefined) {
        const matching = routes.filter((r) => pathMatches(r.path, opts.path!));
        const longest = Math.max(-1, ...matching.map((r) => (r.path ?? "").length));
        routes = matching.filter((r) => (r.path ?? "").length === longest);
      }
      if (routes.length === 0) {
        throw new ApiError(404, `Nenhuma rota para ${host}${opts.path ?? ""}`);
      }

      const provides = await edgesOf(tx, [...new Set(routes.map((r) => r.to.key))], "PROVIDES", "out", s);
      return stampVersions({
        ...(s.environment ? { environment: s.environment } : {}), 
        host,
        ...(opts.path !== undefined ? { path: opts.path } : {}),
        routes: routes.map((r) => ({ ...r, provides: provides.get(r.to.key) ?? [] })),
      }, s);
    });
  }

  /**
   * Retrato da arquitetura numa chamada: componentes (dono, stack, APIs com a contagem de endpoints e os
   * contratos, recursos com o tipo e a instância em que estão, contagem de bibliotecas), dependências lógicas entre eles, tópicos com quem publica e
   * quem assina, e a cobertura (que fontes já publicaram e o que ainda ninguém cobre). Bibliotecas só entram
   * como contagem: o detalhe está em library_usage. A exceção são as que um componente do grafo gera (um framework
   * ou biblioteca interna com repositório): `libraryLinks` liga quem usa ao componente, com o pacote e a versão. Com `domain` ou `team`, só os componentes do recorte e as
   * dependências que entram ou saem dele. Com `component`, a vizinhança dele até `depth` níveis nas duas
   * direções, com o nível de cada componente e as dependências entre todos os do recorte. Cada recurso e
   * instância traz o ambiente em que está (IN_ENVIRONMENT); com `environment`, só ficam os recursos e as
   * instâncias de tópico daquele ambiente (o do recurso ou o da instância em que ele está).
   */
  async architectureOverview(
    filters: { domain?: string; team?: string; component?: string; depth?: number; environment?: string } & StaleOpt = {},
  ) {
    if (filters.component && (filters.domain || filters.team)) {
      throw new ApiError(422, "Use component sozinho, ou domain e team: são recortes diferentes");
    }
    const depth = Math.min(Math.max(filters.depth ?? 1, 1), MAX_DEPTH);
    const scoped = filters.domain || filters.team ? await this.componentsList(filters) : null;
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, filters);
      const environment = s.environment;
      let keys: string[];
      let levels: Map<string, number> | null = null;
      let center: string | null = null;
      if (filters.component) {
        center = (await resolveRef(tx, filters.component, ["Component"])).key;
        levels = (await traverse(tx, center, ["out", "in"], depth, s)).levels;
        keys = [...levels.keys()];
      } else if (scoped) {
        keys = scoped.components.map((c) => c.key);
      } else {
        const all = await tx.run(
          `MATCH (c:Component) WHERE ${liveNode("c", s)} RETURN c.key AS key ORDER BY key LIMIT ${MAX_LIST}`,
          { ...visParams(s) },
        );
        keys = all.records.map((r) => r.get("key") as string);
      }

      const [views, owners, systems, stack, provides, resources, libraries, publishes, subscribes, data] = await Promise.all([
        nodeViews(tx, keys, s),
        edgesOf(tx, keys, "OWNED_BY", "out", s),
        edgesOf(tx, keys, "PART_OF", "out", s),
        edgesOf(tx, keys, "BUILT_WITH", "out", s),
        edgesOf(tx, keys, "PROVIDES", "out", s),
        edgesOf(tx, keys, "USES_RESOURCE", "out", s),
        countOut(tx, keys, "DEPENDS_ON", s),
        edgesOf(tx, keys, "PUBLISHES", "out", s),
        edgesOf(tx, keys, "SUBSCRIBES", "out", s),
        dataUseOf(tx, keys, s),
      ]);
      const apiKeys = [...new Set([...provides.values()].flat().map((e) => e.node.key))];
      const topicKeys = [...new Set([...publishes.values(), ...subscribes.values()].flat().map((e) => e.node.key))];
      const resourceKeys = [...new Set([...resources.values()].flat().map((e) => e.node.key))];
      const systemKeys = [...new Set([...systems.values()].flat().filter((e) => e.node.type === "System").map((e) => e.node.key))];
      const [endpoints, apiContracts, publishers, subscribers, topicContracts, resourceHosts, topicHosts, systemDomains] = await Promise.all([
        countOut(tx, apiKeys, "HAS_ENDPOINT", s),
        edgesOf(tx, apiKeys, "SPECIFIED_BY", "out", s),
        edgesOf(tx, topicKeys, "PUBLISHES", "in", s),
        edgesOf(tx, topicKeys, "SUBSCRIBES", "in", s),
        edgesOf(tx, topicKeys, "SPECIFIED_BY", "out", s),
        edgesOf(tx, resourceKeys, "HOSTED_ON", "out", s),
        edgesOf(tx, topicKeys, "HOSTED_ON", "out", s),
        edgesOf(tx, systemKeys, "PART_OF", "out", s),
      ]);

      // Instância → componente de infraestrutura (INSTANCE_OF): do recurso usado, da instância em que ele está e do broker do tópico.
      const hostKeys = [...resourceHosts.values(), ...topicHosts.values()].flat().map((e) => e.node.key);
      const instanceKeys = [...new Set([...resourceKeys, ...hostKeys])];
      const [instanceOf, environments] = await Promise.all([
        edgesOf(tx, instanceKeys, "INSTANCE_OF", "out", s),
        edgesOf(tx, instanceKeys, "IN_ENVIRONMENT", "out", s),
      ]);
      const infraOf = (key: string) => {
        const [e] = instanceOf.get(key) ?? [];
        return e ? { instanceOf: { key: e.node.key, ...(e.node.name ? { name: e.node.name } : {}), facts: e.facts } } : {};
      };
      const envsOf = (key: string) =>
        (environments.get(key) ?? []).map((e) => ({
          key: e.node.key,
          ...(e.node.name ? { name: e.node.name } : {}),
          ...(e.node.kind ? { kind: e.node.kind } : {}),
          facts: e.facts,
        }));
      const inEnvironment = (key: string) => !environment || (environments.get(key) ?? []).some((e) => e.node.key === environment);
      const hosts = (es: Edge[] | undefined) =>
        (es ?? []).map((h) => ({
          key: h.node.key,
          ...(h.node.name ? { name: h.node.name } : {}),
          ...infraOf(h.node.key),
          environments: envsOf(h.node.key),
          facts: h.facts,
        }));

      // Dependências que saem do recorte; num recorte por domínio ou time, também as que entram nele;
      // na vizinhança de um componente, só as entre componentes da vizinhança.
      let steps = [...(await dependencyStep(tx, keys, "out", s)), ...(scoped ? await dependencyStep(tx, keys, "in", s) : [])];
      if (levels) steps = steps.filter((e) => levels.has(e.to));
      const deps = new Map<string, { from: string; to: string; via: { type: string; node: string; api?: string; endpoint?: { method?: string; path?: string }; facts: DependencyEdge["facts"] }[] }>();
      const seenVia = new Set<string>();
      for (const e of steps) {
        const viaId = JSON.stringify([e.from, e.to, e.via.type, e.via.node.key]);
        if (seenVia.has(viaId)) continue;
        seenVia.add(viaId);
        const id = JSON.stringify([e.from, e.to]);
        if (!deps.has(id)) deps.set(id, { from: e.from, to: e.to, via: [] });
        deps.get(id)!.via.push({
          type: e.via.type,
          node: e.via.node.key,
          ...(e.via.api ? { api: e.via.api.key } : {}),
          ...(e.via.endpoint ? { endpoint: e.via.endpoint } : {}),
          facts: e.facts,
        });
      }

      // Uso das bibliotecas que um componente do grafo gera: o que o recorte usa e, num recorte por domínio ou time
      // ou na vizinhança, também quem usa o que o recorte gera.
      const libraryLinks = new Map<string, LibraryLink>();
      for (const l of [...(await libraryLinksOf(tx, keys, "out", s)), ...(scoped || center ? await libraryLinksOf(tx, keys, "in", s) : [])]) {
        libraryLinks.set(JSON.stringify([l.from, l.to]), l);
      }

      const slim = (es: Edge[] | undefined) => (es ?? []).map((e) => ({ key: e.node.key, ...(e.identity ? { identity: e.identity } : {}), facts: e.facts }));
      const components = views
        .sort((a, b) => (levels ? levels.get(a.key)! - levels.get(b.key)! : 0) || a.key.localeCompare(b.key))
        .map((v) => ({
          key: v.key,
          name: v.props.name,
          kind: v.props.kind,
          ...(deployedVersion(s, v.key) ? { version: deployedVersion(s, v.key) } : {}),
          ...(levels ? { level: levels.get(v.key) } : {}),
          ...(v.status !== "current" ? { status: v.status } : {}),
          owners: slim(owners.get(v.key)),
          systems: (systems.get(v.key) ?? [])
            .filter((e) => e.node.type === "System")
            .map((e) => ({
              key: e.node.key,
              ...(e.node.name ? { name: e.node.name } : {}),
              domains: (systemDomains.get(e.node.key) ?? [])
                .filter((d) => d.node.type === "Domain")
                .map((d) => ({ key: d.node.key, ...(d.node.name ? { name: d.node.name } : {}), facts: d.facts })),
              ...(e.identity ? { identity: e.identity } : {}),
              facts: e.facts,
            })),
          stack: slim(stack.get(v.key)),
          provides: (provides.get(v.key) ?? []).map((e) => ({
            key: e.node.key,
            ...(e.node.kind ? { kind: e.node.kind } : {}),
            endpoints: endpoints.get(e.node.key) ?? 0,
            contracts: (apiContracts.get(e.node.key) ?? []).map((c) => c.node.key),
            facts: e.facts,
          })),
          resources: (resources.get(v.key) ?? [])
            .filter((e) => inEnvironment(e.node.key) || (resourceHosts.get(e.node.key) ?? []).some((h) => inEnvironment(h.node.key)))
            .map((e) => ({
              key: e.node.key,
              ...(e.node.kind ? { kind: e.node.kind } : {}),
              ...(e.node.name ? { name: e.node.name } : {}),
              hostedOn: hosts(resourceHosts.get(e.node.key)),
              ...infraOf(e.node.key),
              environments: envsOf(e.node.key),
              ...(e.identity ? { identity: e.identity } : {}),
              facts: e.facts,
            })),
          data: data.get(v.key) ?? [],
          libraries: libraries.get(v.key) ?? 0,
        }));

      const topicRefs = new Map([...publishes.values(), ...subscribes.values()].flat().map((e) => [e.node.key, e.node]));
      const topics = topicKeys.sort().map((t) => ({
        key: t,
        ...(topicRefs.get(t)?.kind ? { kind: topicRefs.get(t)!.kind } : {}),
        ...(topicRefs.get(t)?.name ? { name: topicRefs.get(t)!.name } : {}),
        publishers: slim(publishers.get(t)),
        subscribers: slim(subscribers.get(t)),
        contracts: (topicContracts.get(t) ?? []).map((c) => c.node.key),
        hostedOn: hosts((topicHosts.get(t) ?? []).filter((h) => inEnvironment(h.node.key))),
      }));

      const [counts, sources, gaps] = await Promise.all([nodeCounts(tx), loadedSources(tx), coverageGaps(tx)]);
      return {
        ...(scoped ? { filters: { domain: filters.domain, team: filters.team } } : {}),
        ...(center ? { center, depth } : {}),
        ...(environment ? { environment } : {}),
        components,
        dependencies: [...deps.values()],
        libraryLinks: [...libraryLinks.values()],
        topics,
        nodes: counts,
        sources,
        ...(gaps.length > 0 ? { gaps } : {}),
        detail: "libraries é só a contagem: use component_libraries ou library_usage (libraryLinks traz só as bibliotecas que um componente do grafo gera); endpoints, api_consumers.",
      };
    });
  }

  /**
   * O que mudou num componente entre dois retratos: `from` e `to` são ambientes (a versão implantada em cada um) ou,
   * omitidos, a linha principal. Por categoria (endpoints oferecidos, APIs consumidas, endpoints chamados, tópicos,
   * datasets, recursos, bibliotecas diretas e stack), o que entrou, o que saiu e o que mudou (versão; contrato, nos
   * endpoints). Um lado sem retrato da versão implantada é a linha principal, e `note` avisa.
   */
  async componentCompare(ref: string, opts: { from?: string; to?: string } = {}) {
    if ((opts.from ?? null) === (opts.to ?? null)) {
      throw new ApiError(422, "from e to são o mesmo retrato: informe ao menos um ambiente diferente do outro lado");
    }
    return this.db.readTx(async (tx) => {
      const { key } = await resolveRef(tx, ref, ["Component"]);
      const a = await resolveView(tx, { environment: opts.from });
      const b = await resolveView(tx, { environment: opts.to });
      const line = await lineRevision(tx, key);
      const [pa, pb] = [await compareProfile(tx, key, a), await compareProfile(tx, key, b)];
      const changes: Record<string, CompareChanges> = {};
      let total = 0;
      for (const cat of COMPARE_CATEGORIES) {
        const d = diffItems(pa.get(cat) ?? new Map(), pb.get(cat) ?? new Map());
        total += d.added.length + d.removed.length + d.changed.length;
        if (d.added.length + d.removed.length + d.changed.length > 0) changes[cat] = d;
      }
      return { component: key, from: compareSide(a, key, line), to: compareSide(b, key, line), same: total === 0, changes };
    });
  }

  /**
   * Busca lexical de nós de qualquer tipo, sem diferenciar maiúsculas: o texto contido no nome, na chave ou num
   * apelido. Ordem: nome igual ao texto, último segmento da chave (ou de um apelido) igual, nome começando por ele, o resto; no
   * empate, componentes primeiro.
   * Com `referencedOnly`, só os nós que nenhuma fonte declarou (existem só como ponta de uma relação).
   */
  nodesFind(opts: { text?: string; types?: NodeType[]; referencedOnly?: boolean; limit?: number } & StaleOpt = {}) {
    const text = (opts.text ?? "").trim().toLowerCase();
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_LIST);
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const res = await tx.run(
        `MATCH (n:Node)
         WHERE ($types IS NULL OR n.type IN $types) AND ${liveNode("n", s)}
         OPTIONAL MATCH (a:Alias)-[:ALIAS_OF]->(n) WHERE $text <> '' AND toLower(a.key) CONTAINS $text
         WITH n, min(a.key) AS alias
         WHERE $text = '' OR toLower(n.key) CONTAINS $text OR toLower(coalesce(n.name, '')) CONTAINS $text OR alias IS NOT NULL
         WITH n, alias, NOT exists { MATCH (:Claim)-[:CLAIMS]->(n) } AS referenced
         WHERE NOT $referencedOnly OR referenced
         WITH n, alias, referenced,
              CASE
                WHEN $text = '' THEN 3
                WHEN toLower(coalesce(n.name, '')) = $text THEN 0
                WHEN any(k IN [toLower(n.key), toLower(coalesce(alias, ''))] WHERE k ENDS WITH '/' + $text OR k ENDS WITH ':' + $text) THEN 1
                WHEN toLower(coalesce(n.name, '')) STARTS WITH $text THEN 2
                ELSE 3
              END AS rank
         RETURN ${nodeRef("n")} AS node, coalesce(n.status, 'current') AS status, referenced, alias
         ORDER BY rank, CASE n.type WHEN 'Component' THEN 0 ELSE 1 END, size(n.key), n.key
         LIMIT ${limit + 1}`,
        {
          text,
          types: opts.types && opts.types.length > 0 ? opts.types : null,
          referencedOnly: !!opts.referencedOnly,
          ...visParams(s),
        },
      );
      const nodes = res.records.map((r) => ({
        ...toNodeRef(r.get("node")),
        status: r.get("status") as string,
        referenced: r.get("referenced") as boolean,
        ...(r.get("alias") ? { matchedAlias: r.get("alias") as string } : {}),
      }));
      return { count: Math.min(nodes.length, limit), truncated: nodes.length > limit, nodes: nodes.slice(0, limit) };
    });
  }

  /**
   * Qualquer nó: as afirmações de existência e todas as relações, agrupadas por tipo e direção, cada uma com as
   * afirmações. Cada grupo traz no máximo MAX_EDGES_PER_GROUP relações, com o total (bibliotecas são muitas).
   */
  nodeGet(ref: string, opts: StaleOpt = {}) {
    return this.db.readTx(async (tx) => {
      const s = await resolveView(tx, opts);
      const { key } = await resolveRef(tx, ref, NODE_TYPE_NAMES);
      const node = await nodeView(tx, key, s);
      const res = await tx.run(
        `MATCH (a:Node {key: $key})-[r]-(b:Node) WHERE ${live("r")}
         RETURN type(r) AS type, startNode(r) = a AS out, ${nodeRef("b")} AS node, properties(r) AS rel
         ORDER BY type, out DESC, b.key, r.source`,
        { key, ...visParams(s) },
      );
      const groups = new Map<string, { type: RelationType; direction: Dir; rows: RelRow[] }>();
      for (const r of res.records) {
        const type = r.get("type") as RelationType;
        if (!(type in RELATION_TYPES)) continue;
        const direction: Dir = r.get("out") ? "out" : "in";
        const id = `${type}:${direction}`;
        const g = groups.get(id) ?? { type, direction, rows: [] };
        g.rows.push({ type, node: r.get("node"), rel: r.get("rel") });
        groups.set(id, g);
      }
      const relations = [...groups.values()].map(({ type, direction, rows }) => {
        const all = groupEdges(rows, direction);
        return {
          type,
          direction,
          description: relationSpec(type).description,
          total: all.length,
          ...(all.length > MAX_EDGES_PER_GROUP ? { truncated: true } : {}),
          edges: all.slice(0, MAX_EDGES_PER_GROUP),
        };
      });
      return { node, relations };
    });
  }

  /**
   * Cobertura das fontes: por fonte, os escopos com a data e as contagens do último retrato (e quem aposentou,
   * se for o caso); as cargas mais recentes; e, para cada tipo de fato que responde perguntas comuns, quais
   * fontes o publicam hoje.
   */
  sourcesStatus(opts: { source?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_LIST);
    return this.db.readTx(async (tx) => {
      const params = { source: opts.source ?? null };
      const scopesRes = await tx.run(
        `MATCH (s:Scope) WHERE s.lastObservedAt IS NOT NULL AND ($source IS NULL OR s.source = $source)
         OPTIONAL MATCH (l:Load {id: s.lastLoadId})
         RETURN s.source AS source, s.scopeKey AS scopeKey, s.lastObservedAt AS lastObservedAt,
                l.receivedAt AS receivedAt, l.counts AS counts, l.retiredBy AS retiredBy, l.reason AS reason,
                s.revisionOf AS revisionOf, s.commit AS commit, s.version AS version, coalesce(s.frozen, false) AS frozen,
                s.producer AS producer, s.producerVersion AS producerVersion
         ORDER BY source, scopeKey`,
        params,
      );
      const bySource = new Map<string, { source: string; lastObservedAt: string; scopes: ScopeStatus[] }>();
      for (const r of scopesRes.records) {
        const source = r.get("source") as string;
        const scope: ScopeStatus = {
          scope: parseScope(r.get("scopeKey")),
          lastObservedAt: r.get("lastObservedAt"),
          ...(r.get("receivedAt") ? { receivedAt: r.get("receivedAt") as string } : {}),
          ...(r.get("counts") ? { counts: JSON.parse(r.get("counts") as string) } : {}),
          ...(r.get("retiredBy") ? { retired: { by: r.get("retiredBy") as string, reason: r.get("reason") as string } } : {}),
          ...(r.get("revisionOf") && r.get("commit")
            ? {
                revision: {
                  component: r.get("revisionOf") as string,
                  commit: r.get("commit") as string,
                  ...(r.get("version") ? { version: r.get("version") as string } : {}),
                  frozen: r.get("frozen") as boolean,
                },
              }
            : {}),
          ...(r.get("producer") ? { producer: { name: r.get("producer") as string, version: r.get("producerVersion") as string } } : {}),
        };
        const entry = bySource.get(source) ?? { source, lastObservedAt: "", scopes: [] };
        entry.scopes.push(scope);
        if (scope.lastObservedAt > entry.lastObservedAt) entry.lastObservedAt = scope.lastObservedAt;
        bySource.set(source, entry);
      }

      const loadsRes = await tx.run(
        `MATCH (l:Load) WHERE $source IS NULL OR l.source = $source
         RETURN properties(l) AS l ORDER BY l.receivedAt DESC, l.observedAt DESC LIMIT ${limit}`,
        params,
      );
      const loads = loadsRes.records.map((r) => {
        const l = r.get("l") as Record<string, unknown>;
        return {
          id: l.id as string,
          source: l.source as string,
          scope: parseScope(l.scopeKey),
          observedAt: l.observedAt as string,
          receivedAt: l.receivedAt as string,
          counts: l.counts ? JSON.parse(l.counts as string) : {},
          ...(l.retiredBy ? { retired: { by: l.retiredBy as string, reason: l.reason as string, evidence: l.evidence as string } } : {}),
        };
      });

      const kinds = Object.keys(COVERAGE) as (keyof typeof COVERAGE)[];
      const factCoverage = await Promise.all(kinds.map(async (k) => ({ kind: k, ...(await coverage(tx, k)) })));
      return {
        sources: [...bySource.values()].map((e) => ({ ...e, scopeCount: e.scopes.length })),
        loads,
        coverage: factCoverage,
      };
    });
  }

  /**
   * Onde as fontes discordam, no retrato atual. Dois casos: `props`, a mesma relação lógica com afirmações que dão
   * valores diferentes à mesma propriedade (ex.: versão); `targets`, uma relação que devia ter um alvo só (dono,
   * sistema, repositório) com alvos diferentes. Cada item traz as afirmações de todas as fontes.
   */
  factDivergences(opts: { relationType?: RelationType; node?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), MAX_LIST);
    return this.db.readTx(async (tx) => {
      const key = opts.node ? (await resolveRef(tx, opts.node, NODE_TYPE_NAMES)).key : null;
      const nodeFilter = "($key IS NULL OR a.key = $key OR b.key = $key)";
      const items: Divergence[] = [];

      const propTypes = RELATION_TYPE_NAMES.filter(
        (t) => (!opts.relationType || t === opts.relationType) && Object.keys(relationSpec(t).props).length > relationSpec(t).identityProps.length,
      );
      for (const type of propTypes) {
        const res = await tx.run(
          `MATCH (a:Node)-[r:${type} {status: 'current'}]->(b:Node) WHERE r.revision IS NULL AND ${nodeFilter}
           WITH a, b, [p IN $identity | r[p]] AS ident, collect(properties(r)) AS rels
           WHERE size(rels) > 1
           RETURN ${nodeRef("a")} AS from, ${nodeRef("b")} AS node, rels ORDER BY a.key, b.key`,
          { key, identity: [...relationSpec(type).identityProps] },
        );
        for (const r of res.records) {
          const [edge] = groupEdges((r.get("rels") as Record<string, unknown>[]).map((rel) => ({ type, node: r.get("node"), rel })), "out");
          const props = divergentProps(edge.facts);
          if (props.length > 0) items.push({ kind: "props", type, from: toNodeRef(r.get("from")), props, edges: [edge] });
        }
      }

      for (const [type, fromTypes] of SINGLE_TARGET) {
        if (opts.relationType && opts.relationType !== type) continue;
        const res = await tx.run(
          `MATCH (a:Node)-[r:${type} {status: 'current'}]->(b:Node) WHERE r.revision IS NULL AND a.type IN $fromTypes AND ${nodeFilter}
           WITH a, collect(DISTINCT b.key) AS targets, collect({node: ${nodeRef("b")}, rel: properties(r)}) AS rows
           WHERE size(targets) > 1
           RETURN ${nodeRef("a")} AS from, rows ORDER BY a.key`,
          { key, fromTypes },
        );
        for (const r of res.records) {
          const rows = (r.get("rows") as { node: Record<string, unknown>; rel: Record<string, unknown> }[]).map((x) => ({ type, ...x }));
          items.push({ kind: "targets", type, from: toNodeRef(r.get("from")), edges: groupEdges(rows, "out") });
        }
      }

      items.sort((a, b) => a.from.key.localeCompare(b.from.key) || a.type.localeCompare(b.type));
      return { count: Math.min(items.length, limit), truncated: items.length > limit, divergences: items.slice(0, limit) };
    });
  }

  /**
   * Endpoint pela chave ou apelido, ou por "MÉTODO /caminho" ou `operationId` entre os endpoints das APIs, no retrato
   * da consulta (um endpoint que só existe numa versão implantada só se acha no recorte daquele ambiente).
   */
  private async resolveEndpoint(tx: ManagedTransaction, ref: string, apis: string[], vis: Vis): Promise<string> {
    if (ref.startsWith(`${NODE_TYPES.Endpoint.prefix}:`)) return (await resolveRef(tx, ref, ["Endpoint"])).key;
    const res = await tx.run(
      `UNWIND $apis AS a
       MATCH (:Node {key: a})-[h:HAS_ENDPOINT]->(e:Endpoint)
       WHERE ${live("h")}
         AND (toUpper(coalesce(e.method, '') + ' ' + coalesce(e.path, '')) = toUpper($ref)
          OR e.key ENDS WITH '/' + $ref
          OR e.operationId = $ref)
       RETURN DISTINCT e.key AS key`,
      { apis, ref: ref.trim(), ...visParams(vis) },
    );
    const keys = res.records.map((r) => r.get("key") as string);
    if (keys.length === 0) throw new ApiError(404, `Endpoint "${ref}" não encontrado nas APIs ${apis.join(", ")}`);
    if (keys.length > 1) throw new ApiError(409, `Endpoint "${ref}" é ambíguo: informe a chave`, { candidates: keys.map((key) => ({ key })) }, "ambiguous");
    return keys[0];
  }
}

/** Categorias comparadas pelo component_compare, cada uma de uma relação que sai do componente. */
const COMPARE_CATEGORIES = [
  "endpoints",
  "consumes",
  "calls",
  "publishes",
  "subscribes",
  "owns",
  "reads",
  "writes",
  "resources",
  "libraries",
  "stack",
] as const;
type CompareCategory = (typeof COMPARE_CATEGORIES)[number];
type CompareItem = { node: NodeRef; value?: string };
export type CompareChanges = { added: NodeRef[]; removed: NodeRef[]; changed: { node: NodeRef; from?: string; to?: string }[] };

const versionOf = (e: Edge) => e.facts.map((f) => f.props?.version).find((v) => typeof v === "string") as string | undefined;

/** O que o componente oferece, consome e usa num retrato, por categoria e chave, com o valor que pode mudar. */
async function compareProfile(tx: ManagedTransaction, key: string, vis: Vis): Promise<Map<CompareCategory, Map<string, CompareItem>>> {
  const out = new Map<CompareCategory, Map<string, CompareItem>>();
  const put = (cat: CompareCategory, items: CompareItem[]) => out.set(cat, new Map(items.map((i) => [i.node.key, i])));
  const rel = (type: RelationType) => edges(tx, key, type, "out", vis);
  const plain = (es: Edge[]) => es.map((e) => ({ node: e.node }));
  const versioned = (es: Edge[]) => es.map((e) => ({ node: e.node, ...(versionOf(e) ? { value: versionOf(e) } : {}) }));

  const provides = await rel("PROVIDES");
  const endpoints = [...(await edgesOf(tx, provides.map((e) => e.node.key), "HAS_ENDPOINT", "out", vis)).values()].flat();
  const contracts = new Map((await nodeViews(tx, endpoints.map((e) => e.node.key), vis)).map((v) => [v.key, v.props.contract]));
  put(
    "endpoints",
    endpoints.map((e) => {
      const c = contracts.get(e.node.key);
      return { node: e.node, ...(typeof c === "string" ? { value: c } : {}) };
    }),
  );
  put("consumes", plain(await rel("CONSUMES")));
  put("calls", plain(await rel("CALLS")));
  put("publishes", plain(await rel("PUBLISHES")));
  put("subscribes", plain(await rel("SUBSCRIBES")));
  put("owns", plain(await rel("OWNS_DATA")));
  put("reads", plain(await rel("READS")));
  put("writes", plain(await rel("WRITES")));
  put("resources", plain(await rel("USES_RESOURCE")));
  put(
    "libraries",
    (await rel("DEPENDS_ON")).map(libraryUse).filter((u) => u.direct).map((u) => ({ node: u.node, ...(u.version ? { value: u.version } : {}) })),
  );
  put("stack", versioned(await rel("BUILT_WITH")));
  return out;
}

function diffItems(a: Map<string, CompareItem>, b: Map<string, CompareItem>): CompareChanges {
  const byKey = (x: { key: string }, y: { key: string }) => x.key.localeCompare(y.key);
  const added = [...b.values()].filter((i) => !a.has(i.node.key)).map((i) => i.node).sort(byKey);
  const removed = [...a.values()].filter((i) => !b.has(i.node.key)).map((i) => i.node).sort(byKey);
  const changed = [...b.values()]
    .filter((i) => a.has(i.node.key) && (a.get(i.node.key)!.value ?? null) !== (i.value ?? null))
    .map((i) => {
      const from = a.get(i.node.key)!.value;
      // O contrato de um endpoint é grande: só se diz que mudou. Versões vêm com o antes e o depois.
      if (i.node.type === "Endpoint") return { node: i.node };
      return { node: i.node, ...(from ? { from } : {}), ...(i.value ? { to: i.value } : {}) };
    })
    .sort((x, y) => byKey(x.node, y.node));
  return { added, removed, changed };
}

/** Um lado da comparação: o ambiente e a versão nele, ou a linha principal. */
function compareSide(vis: Vis, component: string, line: LineRevision | null) {
  if (!vis.environment) return { line: true, ...(line ? { version: line.version, commit: line.commit } : {}) };
  const deployed = vis.deployed.get(component) ?? [];
  const frozen = vis.frozenOf.has(component);
  return {
    environment: vis.environment,
    ...(deployed.length > 0 ? { version: deployedVersion(vis, component), commit: deployed.map((d) => d.commit).join(", ") } : {}),
    frozen,
    ...(deployed.length === 0
      ? { note: "o componente não está implantado neste ambiente, segundo as fontes: este lado é a linha principal" }
      : !frozen
        ? { note: "o grafo não tem o retrato da versão implantada: este lado é a linha principal" }
        : {}),
  };
}

/**
 * De que commit e versão é o retrato da linha principal de um componente: o commit do retrato mais recente entre as
 * fontes, e a versão que alguma fonte informou para esse commit (nem todo artefato traz a versão).
 */
export type LineRevision = { commit: string; version?: string; observedAt: string };

async function lineRevision(tx: ManagedTransaction, component: string): Promise<LineRevision | null> {
  const res = await tx.run(
    `MATCH (s:Scope {revisionOf: $component}) WHERE coalesce(s.frozen, false) = false AND s.commit IS NOT NULL
     RETURN s.commit AS commit, s.version AS version, s.lastObservedAt AS observedAt
     ORDER BY s.lastObservedAt DESC`,
    { component },
  );
  const [latest] = res.records;
  if (!latest) return null;
  const commit = latest.get("commit") as string;
  const version = res.records.find((r) => r.get("commit") === commit && r.get("version"))?.get("version") as string | undefined;
  return { commit, ...(version ? { version } : {}), observedAt: latest.get("observedAt") };
}

/** Uma implantação do componente: em que ambiente, que versão e commit, desde quando e se há retrato daquela versão. */
export type Deployment = {
  environment: NodeRef;
  version: string;
  commit: string;
  image?: string;
  replicas?: string;
  status: string;
  since: string;
  lastSeen: string;
  frozen: boolean;
  sameAsDefault: boolean | null;
  facts: Fact[];
};

/**
 * As implantações (DEPLOYED_IN) vistas a partir do componente, uma por ambiente e commit. `frozen`: o grafo tem o
 * retrato daquele commit (o recorte do ambiente mostra a versão implantada); `sameAsDefault`: o commit é o da linha
 * principal (null quando a linha principal não diz de que commit é).
 */
async function deploymentsOf(tx: ManagedTransaction, component: string, edges: Edge[], line: LineRevision | null): Promise<Deployment[]> {
  if (edges.length === 0) return [];
  const commits = [...new Set(edges.map((e) => e.identity?.commit as string))];
  const res = await tx.run(
    `UNWIND $commits AS c
     MATCH (s:Scope {frozen: true, revisionOf: $component, commit: c})
     RETURN DISTINCT c AS commit`,
    { component, commits },
  );
  const frozen = new Set(res.records.map((r) => r.get("commit") as string));
  return edges
    .map((e): Deployment => {
      const commit = e.identity?.commit as string;
      const props = Object.assign({}, ...e.facts.map((f) => f.props ?? {})) as Record<string, string>;
      const current = e.facts.some((f) => f.status === "current");
      return {
        environment: e.node,
        version: props.version,
        commit,
        ...(props.image ? { image: props.image } : {}),
        ...(props.replicas ? { replicas: props.replicas } : {}),
        status: current ? "current" : "stale",
        since: e.facts.map((f) => f.firstObservedAt).sort()[0],
        lastSeen: e.facts.map((f) => f.observedAt).sort().at(-1)!,
        frozen: frozen.has(commit),
        sameAsDefault: line ? line.commit === commit : null,
        facts: e.facts,
      };
    })
    .sort((a, b) => environmentRank(a.environment) - environmentRank(b.environment) || b.since.localeCompare(a.since));
}

const ENV_ORDER = ["development", "test", "staging", "production"];
const environmentRank = (env: NodeRef) => {
  const i = ENV_ORDER.indexOf(env.kind ?? "");
  return i < 0 ? ENV_ORDER.length : i;
};

/** Um caminho de rota casa quando é prefixo do caminho pedido, em fronteira de segmento. Sem caminho casa tudo. */
function pathMatches(routePath: string | null, path: string): boolean {
  if (!routePath || routePath === "/") return true;
  const prefix = routePath.replace(/\/+$/, "");
  return path === prefix || path.startsWith(`${prefix}/`);
}

async function nodeView(tx: ManagedTransaction, key: string, vis: Vis): Promise<NodeView> {
  const [v] = await nodeViews(tx, [key], vis);
  if (!v) throw new ApiError(404, `Nó "${key}" não encontrado`);
  return v;
}

/**
 * Nós com as afirmações de existência (todas as do retrato da consulta, com o status) e os apelidos. No recorte de um
 * ambiente, as propriedades de um retrato congelado visível (ex.: o contrato de um endpoint naquela versão) valem
 * por cima das do nó, que são as da linha principal.
 */
async function nodeViews(tx: ManagedTransaction, keys: string[], vis: Vis): Promise<NodeView[]> {
  if (keys.length === 0) return [];
  const res = await tx.run(
    `UNWIND $keys AS k
     MATCH (n:Node {key: k})
     RETURN properties(n) AS props,
            [(c:Claim)-[:CLAIMS]->(n) | properties(c)] AS claims,
            [(a:Alias)-[:ALIAS_OF]->(n) | a.key] AS aliases`,
    { keys },
  );
  return res.records.map((r) => {
    const rawClaims = (r.get("claims") as Record<string, unknown>[]).filter((c) => visible(c, vis));
    const frozenProps = rawClaims.filter((c) => c.revision != null && c.props).map((c) => JSON.parse(c.props as string));
    const props = Object.assign({}, r.get("props") as Record<string, unknown>, ...frozenProps) as Record<string, unknown>;
    const claims = rawClaims.map((c) => toFact(c));
    claims.sort((a, b) => a.source.localeCompare(b.source));
    return {
      key: props.key as string,
      type: props.type as string,
      status: (props.status as string | undefined) ?? "current",
      props: Object.fromEntries(Object.entries(props).filter(([k]) => !NODE_META.has(k))),
      referenced: claims.length === 0,
      aliases: (r.get("aliases") as string[]).sort(),
      facts: claims,
    };
  });
}

async function nodeRefs(tx: ManagedTransaction, keys: string[]): Promise<Map<string, NodeRef>> {
  const res = await tx.run(`UNWIND $keys AS k MATCH (n:Node {key: k}) RETURN ${nodeRef("n")} AS n`, { keys });
  return new Map(res.records.map((r) => [r.get("n").key as string, toNodeRef(r.get("n"))]));
}

async function edges(tx: ManagedTransaction, key: string, type: RelationType, dir: Dir, s: Vis): Promise<Edge[]> {
  return (await edgesOf(tx, [key], type, dir, s)).get(key) ?? [];
}

/** Relações de um tipo, numa direção, para vários nós de uma vez. O tipo vem do modelo (seguro no Cypher). */
async function edgesOf(
  tx: ManagedTransaction,
  keys: string[],
  type: RelationType,
  dir: Dir,
  vis: Vis,
): Promise<Map<string, Edge[]>> {
  if (keys.length === 0) return new Map();
  const pattern = dir === "out" ? `(a:Node {key: k})-[r:${type}]->(b:Node)` : `(a:Node {key: k})<-[r:${type}]-(b:Node)`;
  const res = await tx.run(
    `UNWIND $keys AS k
     MATCH ${pattern} WHERE ${live("r")}
     RETURN k, ${nodeRef("b")} AS node, properties(r) AS rel
     ORDER BY b.key, r.source`,
    { keys, ...visParams(vis) },
  );
  const rows = new Map<string, RelRow[]>();
  for (const r of res.records) {
    const k = r.get("k") as string;
    rows.set(k, [...(rows.get(k) ?? []), { type, node: r.get("node"), rel: r.get("rel") }]);
  }
  return new Map([...rows].map(([k, rs]) => [k, groupEdges(rs, dir)]));
}

/**
 * Roda uma consulta que devolve `c` (chave do componente) e `hops` (lista de {type, node, rel}) e agrupa
 * por componente e caminho, juntando as afirmações paralelas de cada passo.
 */
async function paths(
  tx: ManagedTransaction,
  filter: string,
  cypher: string,
  params: Record<string, unknown>,
): Promise<Map<string, { filter: string; path: Hop[] }[]>> {
  const res = await tx.run(cypher, params);
  const byComponent = new Map<string, Map<string, Hop[]>>();
  for (const r of res.records) {
    const c = r.get("c") as string;
    const hops = r.get("hops") as { type: RelationType; node: Record<string, unknown>; rel: Record<string, unknown> }[];
    const sig = JSON.stringify(hops.map((h) => [h.type, h.node.key]));
    const perPath = byComponent.get(c) ?? new Map<string, Hop[]>();
    byComponent.set(c, perPath);
    const known = perPath.get(sig);
    const fresh = hops.map((h) => groupEdges([h])[0]);
    if (!known) perPath.set(sig, fresh);
    else known.forEach((hop, i) => mergeFacts(hop.facts, fresh[i].facts));
  }
  return new Map([...byComponent].map(([c, ps]) => [c, [...ps.values()].map((path) => ({ filter, path }))]));
}

/** Datasets de cada componente, juntando OWNS_DATA, READS e WRITES por dataset. */
async function dataUseOf(tx: ManagedTransaction, keys: string[], s: Vis): Promise<Map<string, DataUse[]>> {
  const [owns, reads, writes] = await Promise.all([
    edgesOf(tx, keys, "OWNS_DATA", "out", s),
    edgesOf(tx, keys, "READS", "out", s),
    edgesOf(tx, keys, "WRITES", "out", s),
  ]);
  const out = new Map<string, DataUse[]>();
  for (const k of keys) {
    const byDataset = new Map<string, DataUse>();
    const add = (es: Edge[] | undefined, field: "owns" | "reads" | "writes") => {
      for (const e of es ?? []) {
        const use = byDataset.get(e.node.key) ?? { dataset: e.node };
        use[field] = e.facts;
        byDataset.set(e.node.key, use);
      }
    };
    add(owns.get(k), "owns");
    add(reads.get(k), "reads");
    add(writes.get(k), "writes");
    if (byDataset.size > 0) out.set(k, [...byDataset.values()].sort((a, b) => a.dataset.key.localeCompare(b.dataset.key)));
  }
  return out;
}

type LibraryLink = { from: string; to: string; packages: { key: string; version?: string; facts: Fact[] }[] };

/**
 * Componente que usa → componente que gera a biblioteca: as dependências diretas (DEPENDS_ON) de um pacote que um
 * componente do grafo gera (PRODUCES), com o pacote e a versão em uso. As bibliotecas de terceiros, que nenhum
 * componente gera, ficam de fora. `out`: o que os componentes de `keys` usam; `in`: quem usa o que eles geram.
 */
async function libraryLinksOf(tx: ManagedTransaction, keys: string[], dir: Dir, vis: Vis): Promise<LibraryLink[]> {
  if (keys.length === 0) return [];
  const pattern =
    dir === "out"
      ? `(a:Component {key: k})-[r:DEPENDS_ON]->(b:Node)<-[p:PRODUCES]-(c:Component)`
      : `(c:Component {key: k})-[p:PRODUCES]->(b:Node)<-[r:DEPENDS_ON]-(a:Component)`;
  const res = await tx.run(
    `UNWIND $keys AS k
     MATCH ${pattern} WHERE a <> c AND ${live("r")} AND ${live("p")} AND ${liveNode("a", vis)}
     RETURN DISTINCT a.key AS user, c.key AS producer, ${nodeRef("b")} AS node, properties(r) AS rel
     ORDER BY user, producer, node.key, rel.source`,
    { keys, ...visParams(vis) },
  );
  const rows = new Map<string, RelRow[]>();
  for (const r of res.records) {
    const id = JSON.stringify([r.get("user"), r.get("producer"), (r.get("node") as { key: string }).key]);
    rows.set(id, [...(rows.get(id) ?? []), { type: "DEPENDS_ON", node: r.get("node"), rel: r.get("rel") }]);
  }
  const links = new Map<string, LibraryLink>();
  for (const [id, rs] of rows) {
    const use = libraryUse(groupEdges(rs, "out")[0]);
    if (!use.direct) continue;
    const [from, to] = JSON.parse(id) as [string, string];
    const link = links.get(JSON.stringify([from, to])) ?? { from, to, packages: [] };
    link.packages.push({ key: use.node.key, ...(use.version ? { version: use.version } : {}), facts: use.facts });
    links.set(JSON.stringify([from, to]), link);
  }
  return [...links.values()];
}

/** Quantas relações current de um tipo saem de cada nó (para listar sem trazer as pontas). */
async function countOut(tx: ManagedTransaction, keys: string[], type: RelationType, vis: Vis): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  const res = await tx.run(
    `UNWIND $keys AS k
     MATCH (:Node {key: k})-[r:${type}]->(b:Node) WHERE ${live("r")}
     RETURN k, count(DISTINCT b) AS n`,
    { keys, ...visParams(vis) },
  );
  return new Map(res.records.map((r) => [r.get("k") as string, r.get("n") as number]));
}

/** Nós por tipo: os current e, à parte, quantos stale ficaram ocultos. */
async function nodeCounts(tx: ManagedTransaction) {
  const res = await tx.run(
    `MATCH (n:Node) RETURN n.type AS type, coalesce(n.status, 'current') AS status, count(n) AS n ORDER BY type`,
  );
  const current: Record<string, number> = {};
  const stale: Record<string, number> = {};
  for (const r of res.records) {
    const bucket = r.get("status") === "current" ? current : stale;
    bucket[r.get("type") as string] = r.get("n") as number;
  }
  return {
    current,
    ...(Object.keys(stale).length > 0 ? { staleHidden: stale, note: "nós que nenhuma fonte afirma mais; includeStale mostra" } : {}),
  };
}

export type SourceCoverage = { source: string; scopes: number; lastObservedAt: string };

/** Fontes que já carregaram retratos: quantos escopos e o retrato mais recente. */
async function loadedSources(tx: ManagedTransaction): Promise<SourceCoverage[]> {
  const res = await tx.run(
    `MATCH (s:Scope) WHERE s.lastObservedAt IS NOT NULL AND coalesce(s.frozen, false) = false
     RETURN s.source AS source, count(s) AS scopes, max(s.lastObservedAt) AS last ORDER BY source`,
  );
  return res.records.map((r) => ({ source: r.get("source"), scopes: r.get("scopes"), lastObservedAt: r.get("last") }));
}

/** O que uma resposta vazia quer dizer: quais fontes afirmam hoje aquele tipo de fato. */
export type Coverage = { what: string; sources: SourceCoverage[]; note?: string };

/** Tipos de fato que respondem perguntas comuns e ficam vazios sem uma fonte específica. */
const COVERAGE = {
  owners: { what: "donos de componentes (OWNED_BY)", relations: ["OWNED_BY"] },
  org: { what: "estrutura organizacional (Group, MEMBER_OF)", nodes: ["Group"], relations: ["MEMBER_OF"] },
  systems: { what: "sistemas e domínios (PART_OF)", relations: ["PART_OF"] },
  resources: { what: "bancos e recursos usados (USES_RESOURCE)", relations: ["USES_RESOURCE"] },
  routes: { what: "rotas de gateway e ingress (ROUTES)", relations: ["ROUTES"] },
  data: { what: "datasets e acessos a eles (OWNS_DATA, READS, WRITES)", relations: ["OWNS_DATA", "READS", "WRITES"] },
  environments: { what: "ambientes da infraestrutura (IN_ENVIRONMENT)", relations: ["IN_ENVIRONMENT"] },
  deployments: { what: "implantações dos componentes nos ambientes (DEPLOYED_IN)", relations: ["DEPLOYED_IN"] },
  libraries: { what: "bibliotecas dos componentes (DEPENDS_ON)", relations: ["DEPENDS_ON"] },
} satisfies Record<string, { what: string; nodes?: NodeType[]; relations: RelationType[] }>;

async function coverage(tx: ManagedTransaction, which: keyof typeof COVERAGE): Promise<Coverage> {
  const spec: { what: string; nodes?: NodeType[]; relations: RelationType[] } = COVERAGE[which];
  const bySource = new Map<string, { scopes: Set<string>; last: string }>();
  const add = (rows: { get(k: string): unknown }[]) => {
    for (const r of rows) {
      const source = r.get("source") as string;
      const e = bySource.get(source) ?? { scopes: new Set<string>(), last: "" };
      (r.get("scopes") as string[]).forEach((x) => e.scopes.add(x));
      const last = r.get("last") as string;
      if (last > e.last) e.last = last;
      bySource.set(source, e);
    }
  };
  if (spec.nodes) {
    const res = await tx.run(
      `MATCH (c:Claim {status: 'current'})-[:CLAIMS]->(n:Node) WHERE n.type IN $types AND c.revision IS NULL
       RETURN c.source AS source, collect(DISTINCT c.scopeKey) AS scopes, max(c.observedAt) AS last`,
      { types: spec.nodes },
    );
    add(res.records);
  }
  for (const t of spec.relations) {
    const res = await tx.run(
      `MATCH ()-[r:${t} {status: 'current'}]->() WHERE r.revision IS NULL
       RETURN r.source AS source, collect(DISTINCT r.scopeKey) AS scopes, max(r.observedAt) AS last`,
    );
    add(res.records);
  }
  const sources = [...bySource]
    .map(([source, e]) => ({ source, scopes: e.scopes.size, lastObservedAt: e.last }))
    .sort((a, b) => a.source.localeCompare(b.source));
  return {
    what: spec.what,
    sources,
    ...(sources.length === 0
      ? { note: `Nenhuma fonte publicou ${spec.what}. Vazio aqui quer dizer sem dados, não que não existe.` }
      : {}),
  };
}

/** O que ninguém cobre ainda, em frases prontas para avisar o usuário. */
async function coverageGaps(tx: ManagedTransaction): Promise<string[]> {
  const all = await Promise.all((Object.keys(COVERAGE) as (keyof typeof COVERAGE)[]).map((k) => coverage(tx, k)));
  return all.filter((c) => c.sources.length === 0).map((c) => c.note!);
}

/** Um salto de um caminho de dependência: `from` depende de `to`, por uma ou mais vias (API, endpoints, tópico). */
export type DependencyHop = {
  from: string;
  to: string;
  via: { type: DependencyEdge["via"]["type"]; node: NodeRef; api?: NodeRef; facts: DependencyEdge["facts"] }[];
};

const MAX_PATHS = 10;

/**
 * Percurso em largura pelas dependências, a partir de `root`, nas direções pedidas. Guarda o menor nível de
 * cada componente, as arestas vistas e, por direção, de onde cada componente foi alcançado pela primeira vez,
 * para montar os caminhos mais curtos (até MAX_PATHS por componente).
 */
async function traverse(tx: ManagedTransaction, root: string, dirs: Dir[], depth: number, s: Vis) {
  const edges = new Map<string, DependencyEdge>();
  const levels = new Map<string, number>([[root, 0]]);
  // Por direção: componente → (vizinho mais perto da raiz → salto).
  const preds = new Map<Dir, Map<string, Map<string, DependencyHop>>>();

  for (const dir of dirs) {
    const p = new Map<string, Map<string, DependencyHop>>();
    preds.set(dir, p);
    let frontier = [root];
    const visited = new Set([root]);
    for (let level = 1; level <= depth && frontier.length > 0; level++) {
      const fresh = new Set<string>();
      const stepEdges = await dependencyStep(tx, frontier, dir, s);
      for (const e of stepEdges) {
        const reached = dir === "out" ? e.to : e.from;
        if (!visited.has(reached)) fresh.add(reached);
      }
      for (const e of stepEdges) {
        const id = JSON.stringify([e.from, e.to, e.via.type, e.via.node.key]);
        const known = edges.get(id);
        if (known) {
          mergeFacts(known.facts.dependent, e.facts.dependent);
          mergeFacts(known.facts.provider, e.facts.provider);
        } else {
          edges.set(id, e);
        }
        const reached = dir === "out" ? e.to : e.from;
        if (!fresh.has(reached)) continue;
        const prev = dir === "out" ? e.from : e.to;
        const byPrev = p.get(reached) ?? new Map<string, DependencyHop>();
        p.set(reached, byPrev);
        const hop = byPrev.get(prev) ?? { from: e.from, to: e.to, via: [] };
        byPrev.set(prev, hop);
        if (!hop.via.some((v) => v.type === e.via.type && v.node.key === e.via.node.key)) {
          hop.via.push({ type: e.via.type, node: e.via.node, ...(e.via.api ? { api: e.via.api } : {}), facts: e.facts });
        }
      }
      for (const k of fresh) {
        visited.add(k);
        if (!levels.has(k)) levels.set(k, level);
      }
      frontier = [...fresh];
    }
  }

  /** Caminhos mais curtos entre `key` e a raiz, no sentido da dependência (quem depende vem primeiro). */
  const paths = (key: string): DependencyHop[][] => {
    const out: DependencyHop[][] = [];
    for (const [dir, p] of preds) {
      const walk = (k: string): DependencyHop[][] => {
        if (k === root) return [[]];
        const acc: DependencyHop[][] = [];
        for (const [prev, hop] of p.get(k) ?? []) {
          for (const rest of walk(prev)) {
            acc.push(dir === "out" ? [...rest, hop] : [hop, ...rest]);
            if (acc.length >= MAX_PATHS) return acc;
          }
        }
        return acc;
      };
      out.push(...walk(key));
    }
    return out.slice(0, MAX_PATHS);
  };

  return { levels, edges, paths };
}

/** Um nível de dependências para vários componentes, numa direção. */
async function dependencyStep(tx: ManagedTransaction, keys: string[], dir: Dir, vis: Vis): Promise<DependencyEdge[]> {
  // `x` depende de `y`. Em `out` a chave é de x; em `in`, de y.
  const x = dir === "out" ? "(x:Component {key: k})" : "(x:Component)";
  const y = dir === "in" ? "(y:Component {key: k})" : "(y:Component)";
  const res = await tx.run(
    `UNWIND $keys AS k
     CALL {
       WITH k
       MATCH ${x}-[r1:CONSUMES]->(v:Api)<-[r2:PROVIDES]-${y}
       WHERE ${live("r1")} AND ${live("r2")}
       RETURN x, y, 'CONSUMES' AS kind, v, null AS a, r1, r2
       UNION ALL
       WITH k
       MATCH ${x}-[r1:CALLS]->(v:Endpoint)<-[h:HAS_ENDPOINT]-(a:Api)<-[r2:PROVIDES]-${y}
       WHERE ${live("r1")} AND ${live("h")} AND ${live("r2")}
       RETURN x, y, 'CALLS' AS kind, v, a, r1, r2
       UNION ALL
       WITH k
       MATCH ${x}-[r1:SUBSCRIBES]->(v:Topic)<-[r2:PUBLISHES]-${y}
       WHERE ${live("r1")} AND ${live("r2")}
       RETURN x, y, 'SUBSCRIBES' AS kind, v, null AS a, r1, r2
     }
     WITH x, y, kind, v, a, r1, r2 WHERE x <> y
     RETURN x.key AS from, y.key AS to, kind, ${nodeRef("v")} AS via, CASE WHEN a IS NULL THEN null ELSE ${nodeRef("a")} END AS api,
            CASE WHEN kind = 'CALLS' THEN {method: v.method, path: v.path} ELSE null END AS endpoint,
            type(r1) AS t1, properties(r1) AS r1, type(r2) AS t2, properties(r2) AS r2`,
    { keys, ...visParams(vis) },
  );
  const byId = new Map<string, DependencyEdge>();
  for (const r of res.records) {
    const via = toNodeRef(r.get("via"));
    const kind = r.get("kind") as DependencyEdge["via"]["type"];
    const id = JSON.stringify([r.get("from"), r.get("to"), kind, via.key]);
    let e = byId.get(id);
    if (!e) {
      const api = r.get("api") as Record<string, unknown> | null;
      const ep = r.get("endpoint") as { method: string | null; path: string | null } | null;
      const endpoint = ep && (ep.method || ep.path) ? { ...(ep.method ? { method: ep.method } : {}), ...(ep.path ? { path: ep.path } : {}) } : undefined;
      e = {
        from: r.get("from"),
        to: r.get("to"),
        via: { type: kind, node: via, ...(api ? { api: toNodeRef(api) } : {}), ...(endpoint ? { endpoint } : {}) },
        facts: { dependent: [], provider: [] },
      };
      byId.set(id, e);
    }
    mergeFacts(e.facts.dependent, [relFact(r.get("t1"), r.get("r1"))]);
    mergeFacts(e.facts.provider, [relFact(r.get("t2"), r.get("r2"))]);
  }
  return [...byId.values()];
}

