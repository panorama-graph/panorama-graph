import dagre from "@dagrejs/dagre";
import type { DependencyEdge, DependencyFacts, EndpointRef, Fact, InstanceOf, NodeRef, Overview, OverviewDependency, OverviewHost, Slim } from "./types";
import { channelWords, displayName, environmentsOf } from "./nodes";
import { COMPONENT_LAYERS, resourceLayer } from "./layers";
import { isFamilyLibrary, techInfo, techOf, type TechRole } from "./tech";

/**
 * Nó no desenho: componente, tópico ou recurso. O recurso junta os ambientes (`keys`: uma chave por ambiente, a
 * primeira é `key`); `caption` é a legenda abaixo do nome.
 */
export type GraphNode = {
  key: string;
  name: string;
  type?: "Component" | "Topic" | "Resource";
  kind?: string;
  caption?: string;
  /** Tecnologia reconhecida do recurso (`lib/tech`), para o ícone. */
  tech?: string;
  /** Do componente: com o que é construído (`BUILT_WITH`), para as insígnias e a lista ao expandir. */
  stack?: StackItem[];
  keys?: string[];
  /** Domínio em cujo contorno o nó fica (chave de um `GraphGroup`). */
  group?: string;
  level?: number;
  stale?: boolean;
  center?: boolean;
};

/** Uma via de uma dependência, com as afirmações das duas pontas. */
export type GraphVia = { type: string; node: string; api?: string; endpoint?: EndpointRef; facts: DependencyFacts };

/** Grupo de afirmações de uma aresta que não é dependência entre componentes (publica, assina, usa recurso). */
export type GraphFacts = { title: string; subtitle?: string; sections: { label?: string; facts: Fact[] }[] };

/**
 * Aresta no desenho: `from` depende de `to` (ou o usa). A dependência entre componentes vem com as vias; a ligação
 * com tópico ou recurso, com as afirmações prontas para o painel (`facts`).
 */
export type GraphEdge = { id: string; from: string; to: string; via: GraphVia[]; label: string; facts?: GraphFacts };

/** Uma tecnologia da stack: o papel e o ícone, quando conhecidos; a versão, como as fontes afirmam. */
export type StackItem = { key: string; name: string; tech?: string; label?: string; role?: TechRole; version?: string; facts: Fact[] };

/**
 * Stack do componente: as conhecidas primeiro (linguagem, framework, build), depois as demais pelo nome. A que tem o
 * nome de um componente `library` do grafo (`libraries`) ou de uma biblioteca de família conhecida (`spring-cloud`)
 * ganha o ícone de biblioteca.
 */
export function stackOf(stack: Slim[], libraries: Set<string> = new Set()): StackItem[] {
  const order: (TechRole | undefined)[] = ["language", "framework", "build"];
  const rank = (i: StackItem) => (i.role && order.includes(i.role) ? order.indexOf(i.role) : order.length);
  return stack
    .map((t) => {
      const name = displayName({ key: t.key });
      const info = techInfo(t.key);
      const versions = [...new Set(t.facts.map((f) => f.props?.version).filter((v): v is string => typeof v === "string"))];
      return {
        key: t.key,
        name,
        ...(info ? { tech: info.id, label: info.label, role: info.role } : libraries.has(name) || isFamilyLibrary(t.key) ? { tech: LIBRARY } : {}),
        ...(versions.length ? { version: versions.join(" / ") } : {}),
        facts: t.facts,
      };
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Ícone de biblioteca (`images/library-icon.svg`): componentes `library` e o que a stack usa deles. */
export const LIBRARY = "library";

export type Positioned = GraphNode & { x: number; y: number };
export type PositionedGroup = GraphGroup & { x: number; y: number; width: number; height: number };

const NODE_W = 200;
const NODE_H = 56;

const VIA_LABEL: Record<string, string> = { CONSUMES: "API", CALLS: "endpoint", SUBSCRIBES: "evento" };

/**
 * Rótulo curto da aresta: os tipos de via, sem repetir, e os endpoints. Um endpoint só aparece pelo método e caminho
 * (`GET /products/{id}`); mais de um, pela contagem, e o botão do rótulo lista os endpoints (`edgeEndpoints`).
 */
export function edgeLabel(via: GraphVia[]): string {
  const calls = [...new Map(via.filter((v) => v.type === "CALLS").map((v) => [v.node, v])).values()];
  const types = [...new Set(via.map((v) => v.type))].filter((t) => t !== "CALLS");
  const parts = types.map((t) => VIA_LABEL[t] ?? t);
  const [only] = calls;
  if (calls.length === 1 && only.endpoint?.method && only.endpoint.path) parts.push(`${only.endpoint.method} ${only.endpoint.path}`);
  else if (calls.length > 0) parts.push(`${calls.length} endpoint${calls.length > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

/** Um endpoint chamado numa dependência: a chave (a página dele), o método e o caminho que o grafo afirma. */
export type EndpointItem = { key: string; method?: string; path?: string };

/**
 * Os endpoints chamados (via CALLS), pelo caminho e pelo método, que o botão do rótulo lista quando são mais de um
 * (um só já está no rótulo). Sem método e caminho afirmados, o endpoint aparece pelo nome do nó.
 */
export function edgeEndpoints(e: GraphEdge): EndpointItem[] {
  const seen = new Set<string>();
  return e.via
    .filter((v) => v.type === "CALLS" && !seen.has(v.node) && seen.add(v.node))
    .map((v) => ({ key: v.node, ...(v.endpoint ?? {}) }))
    .sort((a, b) => (a.path ?? a.key).localeCompare(b.path ?? b.key) || (a.method ?? "").localeCompare(b.method ?? ""));
}

/** Arestas da visão geral (`architecture_overview`): já vêm agrupadas por par, com as vias. */
export function fromOverview(deps: OverviewDependency[]): GraphEdge[] {
  return deps.map((d) => ({ id: `${d.from}->${d.to}`, from: d.from, to: d.to, via: d.via, label: edgeLabel(d.via) }));
}

/** Arestas do `component_dependencies`: uma por via; aqui viram uma por par, sem repetir a mesma via. */
export function fromDependencyEdges(edges: DependencyEdge[]): GraphEdge[] {
  const byPair = new Map<string, GraphEdge>();
  const seen = new Set<string>();
  for (const e of edges) {
    const viaId = JSON.stringify([e.from, e.to, e.via.type, e.via.node.key]);
    if (seen.has(viaId)) continue;
    seen.add(viaId);
    const id = `${e.from}->${e.to}`;
    const edge = byPair.get(id) ?? { id, from: e.from, to: e.to, via: [], label: "" };
    edge.via.push({
      type: e.via.type,
      node: e.via.node.key,
      ...(e.via.api ? { api: e.via.api.key } : {}),
      ...(e.via.endpoint ? { endpoint: e.via.endpoint } : {}),
      facts: e.facts,
    });
    byPair.set(id, edge);
  }
  return [...byPair.values()].map((e) => ({ ...e, label: edgeLabel(e.via) }));
}

/** Tipos de acesso afirmados no uso de um recurso (read, write...), juntos. */
const accessOf = (uses: { facts: Fact[] }[]) =>
  [...new Set(uses.flatMap((u) => u.facts.map((f) => f.props?.access)).filter((a): a is string => typeof a === "string"))].join(" · ");

/** Contorno de um domínio no desenho, com os sistemas que o ligam aos componentes de dentro. */
export type GraphGroup = { key: string; name: string; systems: string[] };

export type GraphSelection = { nodes: GraphNode[]; edges: GraphEdge[]; groups?: GraphGroup[] };

const RESOURCE_LABEL: Record<string, string> = { database: "banco", bucket: "bucket", cache: "cache", broker: "mensageria" };
const API_VIAS = new Set(["CONSUMES", "CALLS"]);

/** Os ambientes de um recurso ou instância, em texto, e a posição do primeiro na ordem até a produção. */
type Env = { names: string; rank: number };
const envOf = (r: Parameters<typeof environmentsOf>[0]): Env => {
  const envs = environmentsOf(r);
  return { names: envs.map((e) => e.name).join(", "), rank: envs[0]?.rank ?? Infinity };
};
const inEnv = (env: Env) => (env.names ? `${env.names} · ` : "");
const byEnv = (a: { key: string; env: Env }, b: { key: string; env: Env }) => a.env.rank - b.env.rank || a.key.localeCompare(b.key);

/**
 * O desenho da `architecture_overview` com as camadas marcadas (ver `layers.ts`): os componentes dos tipos
 * marcados (o centro e os sem tipo, sempre), as dependências por API, os tópicos com quem publica e quem assina, e
 * os recursos usados. Toda seta sai de quem usa: componente → componente (API), componente → tópico (publica ou
 * assina) e componente → recurso. Cada recurso vira um nó só, juntando os ambientes pelo tipo, nome e instância.
 * Num recorte por domínio ou time, quem está do outro lado de uma dependência por API entra como nó de fora.
 */
export function overviewGraph(data: Overview, layers: Set<string>): GraphSelection {
  const center = data.center;
  const known = new Set(COMPONENT_LAYERS.map((l) => l.id));
  const visible = data.components.filter((c) => c.key === center || !c.kind || !known.has(c.kind) || layers.has(c.kind));
  const libraries = new Set(data.components.filter((c) => c.kind === "library").map((c) => displayName(c)));
  const nodes = visible.map((c) => {
    const stack = stackOf(c.stack, libraries);
    const node = toGraphNode({ ...c, type: "Component" }, center);
    return { ...node, ...(stack.length ? { stack } : {}), ...componentTech(c) };
  });
  const shown = new Set(nodes.map((n) => n.key));
  const listed = new Set(data.components.map((c) => c.key));
  const names = new Map(nodes.map((n) => [n.key, n.name]));
  const nameOf = (key: string) => names.get(key) ?? displayName({ key });
  const edges: GraphEdge[] = [];

  if (layers.has("api")) {
    const deps = data.dependencies
      .map((d) => ({ ...d, via: d.via.filter((v) => API_VIAS.has(v.type)) }))
      .filter((d) => d.via.length > 0);
    edges.push(...fromOverview(deps));
    const outside = new Set(deps.flatMap((d) => [d.from, d.to]).filter((k) => !listed.has(k)));
    for (const key of outside) nodes.push(toGraphNode({ key, type: "Component" }));
  }

  // Com a camada library, quem usa → o componente que gera a biblioteca (um framework ou biblioteca interna com
  // repositório). As de terceiros não entram. Quem está fora do recorte entra como nó de fora; o que está no recorte
  // e numa camada desligada não entra.
  if (layers.has("library")) {
    const reach = (key: string, library: boolean) => {
      if (nodes.some((n) => n.key === key)) return true;
      if (listed.has(key)) return false;
      nodes.push({ ...toGraphNode({ key, type: "Component", ...(library ? { kind: "library" } : {}) }), ...(library ? { tech: LIBRARY } : {}) });
      return true;
    };
    for (const l of data.libraryLinks ?? []) {
      if (!reach(l.from, false) || !reach(l.to, true)) continue;
      const versions = [...new Set(l.packages.map((p) => p.version).filter(Boolean))];
      const [only] = l.packages;
      edges.push({
        id: `biblioteca:${l.from}->${l.to}`,
        from: l.from,
        to: l.to,
        via: [],
        label: l.packages.length === 1 ? `${packageName(only.key)}${only.version ? ` ${only.version}` : ""}` : `${l.packages.length} pacotes${versions.length === 1 ? ` · ${versions[0]}` : ""}`,
        facts: {
          title: `${nameOf(l.from)} usa ${nameOf(l.to)}`,
          subtitle: "Os pacotes que o componente gera e que este usa diretamente, com a versão em uso.",
          sections: l.packages.map((p) => ({ label: `${packageName(p.key)}${p.version ? ` ${p.version}` : ""}`, facts: p.facts })),
        },
      });
    }
  }

  // O componente de infraestrutura (`INSTANCE_OF`) entra quando algo desenhado está nele, mesmo com a camada
  // infra desligada: o broker usado vira o próprio componente, e o banco e o tópico apontam para o servidor em que estão.
  const infraNode = (ref: InstanceOf): GraphNode => {
    const found = nodes.find((n) => n.key === ref.key);
    if (found) return found;
    const c = data.components.find((x) => x.key === ref.key);
    const comp = c ?? { key: ref.key, name: ref.name, kind: "infra" };
    const node = { ...toGraphNode({ ...comp, type: "Component" }, center), ...componentTech(comp) };
    nodes.push(node);
    return node;
  };

  type Hosting = { ref: InstanceOf; hosts: { key: string; host: string; facts: Fact[]; instanceOf: Fact[]; env: Env }[] };
  const addHosts = (servers: Map<string, Hosting>, key: string, hostedOn: OverviewHost[] | undefined) => {
    for (const h of hostedOn ?? []) {
      if (!h.instanceOf) continue;
      const server = servers.get(h.instanceOf.key) ?? { ref: h.instanceOf, hosts: [] };
      if (!server.hosts.some((x) => x.key === key && x.host === h.key)) {
        server.hosts.push({ key, host: h.key, facts: h.facts ?? [], instanceOf: h.instanceOf.facts, env: envOf({ environments: h.environments }) });
      }
      servers.set(h.instanceOf.key, server);
    }
  };
  // Seta "está em" do banco ou do tópico até o componente de infraestrutura, com as afirmações de cada ambiente:
  // o que está na instância e de que componente a instância é.
  const hostedEdges = (node: GraphNode, servers: Map<string, Hosting>, what: string) => {
    for (const { ref, hosts } of servers.values()) {
      const server = infraNode(ref);
      edges.push({
        id: `hospedado:${node.key}->${server.key}`,
        from: node.key,
        to: server.key,
        via: [],
        label: "está em",
        facts: {
          title: `${node.name} está em ${server.name}`,
          subtitle: `${what} está na instância de cada ambiente, que é a implantação de ${server.name}.`,
          sections: hosts
            .sort((a, b) => a.env.rank - b.env.rank || a.key.localeCompare(b.key) || a.host.localeCompare(b.host))
            .flatMap((h) => [
              { label: `${inEnv(h.env)}${h.key} está em ${h.host}`, facts: h.facts },
              { label: `${inEnv(h.env)}${h.host} é instância de ${server.name}`, facts: h.instanceOf },
            ]),
        },
      });
    }
  };

  // O que os tópicos desenhados já mostram: por componente e componente de infraestrutura, as instâncias em que estão
  // os tópicos que o componente publica ou assina, e as setas desses tópicos. Ver o uso direto do broker, abaixo.
  const viaTopic = new Map<string, { instances: Set<string>; edges: GraphEdge[] }>();
  const pairId = (component: string, infra: string) => JSON.stringify([component, infra]);
  if (layers.has("eventos")) {
    for (const t of data.topics) {
      const ends = [
        ...t.publishers.filter((p) => shown.has(p.key)).map((p) => ({ ...p, end: "publica" })),
        ...t.subscribers.filter((p) => shown.has(p.key)).map((p) => ({ ...p, end: "assina" })),
      ];
      if (ends.length === 0) continue;
      const topicName = displayName(t);
      const words = channelWords(t.kind);
      // A insígnia é a tecnologia do broker em que o tópico está (o componente de infraestrutura ou a instância).
      const tech = techOf((t.hostedOn ?? []).flatMap((h) => [h.instanceOf?.name, h.name]));
      const topic: GraphNode = { key: t.key, name: topicName, type: "Topic", caption: words.noun, ...(tech ? { tech } : {}) };
      nodes.push(topic);
      for (const e of ends) {
        const verb = e.end === "publica" ? words.publish : words.subscribe;
        const edge: GraphEdge = {
          id: `${e.end}:${e.key}->${t.key}`,
          from: e.key,
          to: t.key,
          via: [],
          label: verb,
          facts: { title: `${nameOf(e.key)} ${verb} ${topicName}`, sections: [{ facts: e.facts }] },
        };
        edges.push(edge);
        for (const h of t.hostedOn ?? []) {
          if (!h.instanceOf) continue;
          const id = pairId(e.key, h.instanceOf.key);
          const covered = viaTopic.get(id) ?? { instances: new Set<string>(), edges: [] };
          covered.instances.add(h.key);
          if (!covered.edges.includes(edge)) covered.edges.push(edge);
          viaTopic.set(id, covered);
        }
      }
      // O broker em que o tópico está, com a camada dele (mensageria) ou a de infraestrutura.
      if (layers.has("mensageria") || layers.has("infra")) {
        const servers = new Map<string, Hosting>();
        addHosts(servers, t.key, t.hostedOn);
        hostedEdges(topic, servers, words.the);
      }
    }
  }

  type Use = { key: string; facts: Fact[]; instanceOf?: InstanceOf; env: Env };
  type Group = { node: GraphNode; infra?: boolean; users: Map<string, Use[]>; servers: Map<string, Hosting> };
  const groups = new Map<string, Group>();
  for (const c of visible) {
    for (const r of c.resources) {
      const layer = resourceLayer(r.kind);
      if (!layer || !layers.has(layer)) continue;
      const name = r.name ?? displayName({ key: r.key });
      const instances = [...new Set((r.hostedOn ?? []).map((h) => h.name ?? displayName({ key: h.key })))].sort();
      const id = r.instanceOf ? JSON.stringify(["infra", r.instanceOf.key]) : JSON.stringify([r.kind ?? "", name, instances]);
      if (!groups.has(id)) {
        if (r.instanceOf) {
          groups.set(id, { node: infraNode(r.instanceOf), infra: true, users: new Map(), servers: new Map() });
        } else {
          const kindLabel = (r.kind && RESOURCE_LABEL[r.kind]) || r.kind || "recurso";
          const tech = techOf([...instances, name]);
          groups.set(id, {
            node: { key: r.key, name, type: "Resource", kind: r.kind, caption: [kindLabel, ...instances].join(" · "), keys: [], ...(tech ? { tech } : {}) },
            users: new Map(),
            servers: new Map(),
          });
        }
      }
      const g = groups.get(id)!;
      if (!g.infra && !g.node.keys!.includes(r.key)) g.node.keys!.push(r.key);
      g.users.set(c.key, [...(g.users.get(c.key) ?? []), { key: r.key, facts: r.facts, ...(r.instanceOf ? { instanceOf: r.instanceOf } : {}), env: envOf(r) }]);
      addHosts(g.servers, r.key, r.hostedOn);
    }
  }
  for (const { node, infra, users, servers } of groups.values()) {
    if (!infra) {
      node.keys!.sort();
      node.key = node.keys![0];
      nodes.push(node);
    }
    for (const [from, uses] of users) {
      // O uso direto do broker some quando os tópicos desenhados do componente estão em todas as instâncias que ele
      // usa: o caminho componente → tópico → broker já mostra a ligação. As afirmações do uso vão para o painel da
      // seta do tópico. Uso em instância sem tópico conhecido continua com a seta direta.
      const covered = infra ? viaTopic.get(pairId(from, node.key)) : undefined;
      if (covered && uses.every((u) => covered.instances.has(u.key))) {
        for (const edge of covered.edges) {
          edge.facts!.sections.push(
            ...uses
              .sort(byEnv)
              .flatMap((u) => [
                { label: `${inEnv(u.env)}${nameOf(from)} usa ${u.key}${accessOf([u]) ? ` (${accessOf([u])})` : ""}`, facts: u.facts },
                ...(u.instanceOf ? [{ label: `${inEnv(u.env)}${u.key} é instância de ${node.name}`, facts: u.instanceOf.facts }] : []),
              ]),
          );
        }
        continue;
      }
      const access = accessOf(uses);
      const sorted = uses.sort(byEnv);
      edges.push({
        id: `usa:${from}->${node.key}`,
        from,
        to: node.key,
        via: [],
        label: access || "usa",
        facts: {
          title: `${nameOf(from)} usa ${node.name}`,
          subtitle: infra
            ? "Usa a instância de cada ambiente, que é a implantação deste componente: o uso e a instância, por ambiente."
            : uses.length > 1
              ? "O mesmo recurso em cada ambiente: as afirmações de cada um."
              : undefined,
          sections: sorted.flatMap((u) => [
            { label: `${inEnv(u.env)}${u.key}`, facts: u.facts },
            ...(u.instanceOf ? [{ label: `${inEnv(u.env)}${u.key} é instância de ${node.name}`, facts: u.instanceOf.facts }] : []),
          ]),
        },
      });
    }
    hostedEdges(node, servers, "O banco");
  }

  return layers.has("dominios") ? { nodes, edges, groups: groupByDomain(data, nodes, edges) } : { nodes, edges };
}

/**
 * Agrupamento por domínio (componente → sistema → domínio): o componente fica no contorno do domínio quando as
 * fontes afirmam um domínio só; com mais de um, ou nenhum, fica fora. O tópico e o recurso entram no domínio quando
 * todos os componentes que os usam no desenho estão nele. Marca `group` nos nós e devolve os contornos.
 */
function groupByDomain(data: Overview, nodes: GraphNode[], edges: GraphEdge[]): GraphGroup[] {
  const groups = new Map<string, { name: string; systems: Set<string> }>();
  const domainOf = new Map<string, string>();
  for (const c of data.components) {
    const domains = new Map<string, { name: string; systems: string[] }>();
    for (const sys of c.systems) {
      const sysName = sys.name ?? displayName({ key: sys.key });
      for (const d of sys.domains ?? []) {
        const entry = domains.get(d.key) ?? { name: d.name ?? displayName({ key: d.key }), systems: [] };
        entry.systems.push(sysName);
        domains.set(d.key, entry);
      }
    }
    if (domains.size !== 1) continue;
    const [[key, { name, systems }]] = [...domains];
    domainOf.set(c.key, key);
    const g = groups.get(key) ?? { name, systems: new Set<string>() };
    systems.forEach((x) => g.systems.add(x));
    groups.set(key, g);
  }

  // O "está em" (físico) não conta: o banco e o tópico ficam no domínio de quem os usa.
  const ends = new Map<string, string[]>();
  for (const e of edges.filter((x) => !x.id.startsWith("hospedado:"))) {
    ends.set(e.from, [...(ends.get(e.from) ?? []), e.to]);
    ends.set(e.to, [...(ends.get(e.to) ?? []), e.from]);
  }
  for (const n of nodes) {
    if (n.type === "Component") {
      const d = domainOf.get(n.key);
      if (d) n.group = d;
      continue;
    }
    const around = new Set((ends.get(n.key) ?? []).map((k) => domainOf.get(k)));
    const [only] = around;
    if (around.size === 1 && only) n.group = only;
  }

  const used = new Set(nodes.map((n) => n.group).filter(Boolean));
  return [...groups]
    .filter(([key]) => used.has(key))
    .map(([key, g]) => ({ key, name: g.name, systems: [...g.systems].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Nome do pacote sem o grupo: `lib:maven/br.com.acme:platform-bom` → `platform-bom`. */
function packageName(key: string): string {
  const name = displayName({ key });
  return name.slice(name.lastIndexOf(":") + 1);
}

/** Ícone do componente: biblioteca, ou a tecnologia que o componente de infraestrutura é (mongodb, kafka...). */
function componentTech(c: { key: string; name?: string; kind?: string }): { tech?: string; caption?: string } {
  if (c.kind === "library") return { tech: LIBRARY };
  if (c.kind !== "infra") return {};
  const tech = techOf([c.name ?? displayName(c)]);
  return { caption: "infra", ...(tech ? { tech } : {}) };
}

export const toGraphNode = (n: NodeRef & { level?: number; status?: string }, center?: string): GraphNode => ({
  key: n.key,
  name: displayName(n),
  type: "Component",
  ...(n.kind ? { kind: n.kind } : {}),
  // No recorte de um ambiente, a versão implantada nele vem na legenda.
  ...(n.version ? { caption: `${n.kind ?? "componente"} · ${n.version}` } : {}),
  ...(n.level !== undefined ? { level: n.level } : {}),
  ...(n.status && n.status !== "current" ? { stale: true } : {}),
  ...(center === n.key ? { center: true } : {}),
});

/** Folga do contorno do domínio: em cima cabe o título e as insígnias dos cartões. */
const GROUP_PAD = { top: 44, side: 20, bottom: 20 };

/**
 * Posições da esquerda para a direita, no sentido da dependência (quem depende fica à esquerda). Arestas para
 * nós fora da lista são ignoradas. Com grupos, o layout é composto: os nós de um domínio ficam juntos, e o
 * contorno é a caixa deles com folga.
 */
export function layout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  groups: GraphGroup[] = [],
): { nodes: Positioned[]; edges: GraphEdge[]; groups: PositionedGroup[] } {
  const grouped = groups.length > 0;
  const g = new dagre.graphlib.Graph({ compound: grouped });
  g.setGraph({ rankdir: "LR", nodesep: grouped ? 56 : 28, ranksep: 90, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  const keys = new Set(nodes.map((n) => n.key));
  const groupKeys = new Set(groups.map((x) => x.key));
  for (const x of groups) g.setNode(x.key, {});
  for (const n of nodes) {
    g.setNode(n.key, { width: NODE_W, height: NODE_H });
    if (n.group && groupKeys.has(n.group)) g.setParent(n.key, n.group);
  }
  const kept = edges.filter((e) => keys.has(e.from) && keys.has(e.to) && e.from !== e.to);
  for (const e of kept) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const placed = nodes.map((n) => {
    const p = g.node(n.key);
    return { ...n, x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  });
  const boxes = groups.flatMap((x) => {
    const inside = placed.filter((n) => n.group === x.key);
    if (inside.length === 0) return [];
    const left = Math.min(...inside.map((n) => n.x)) - GROUP_PAD.side;
    const top = Math.min(...inside.map((n) => n.y)) - GROUP_PAD.top;
    const right = Math.max(...inside.map((n) => n.x + NODE_W)) + GROUP_PAD.side;
    const bottom = Math.max(...inside.map((n) => n.y + NODE_H)) + GROUP_PAD.bottom;
    return [{ ...x, x: left, y: top, width: right - left, height: bottom - top }];
  });
  return { nodes: placed, edges: kept, groups: boxes };
}

export const GRAPH_NODE_SIZE = { width: NODE_W, height: NODE_H };
