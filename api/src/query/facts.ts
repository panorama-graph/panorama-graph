import { relationSpec, type RelationType } from "../model/model";

/** Uma afirmação, como as consultas devolvem: quem afirmou, onde viu, quando, e com que confiança. */
export type Fact = {
  source: string;
  scope: Record<string, string>;
  state: string;
  status: string;
  evidence: string;
  observedAt: string;
  firstObservedAt: string;
  /** Propriedades da relação que a fonte afirmou (ex.: `version`). Ficam por afirmação, para a divergência aparecer. */
  props?: Record<string, unknown>;
};

/** Ponta de uma relação: o suficiente para identificar o nó e seguir com outra ferramenta. */
export type NodeRef = { key: string; type: string; name?: string; kind?: string; version?: string };

/**
 * Relação lógica vista de um nó: o tipo, o nó do outro lado e uma afirmação por fonte e escopo. `direction` é o
 * sentido visto do nó dono: `out` (dono → node) ou `in` (node → dono).
 */
export type Edge = {
  type: RelationType;
  node: NodeRef;
  direction?: "out" | "in";
  identity?: Record<string, unknown>;
  facts: Fact[];
};

/** Projeção Cypher de uma ponta. */
export const nodeRef = (v: string) => `{key: ${v}.key, type: ${v}.type, name: ${v}.name, kind: ${v}.kind, version: ${v}.version}`;

/** A versão do nó, quando há: a da interface (Api, Topic). A do componente implantado vem depois, de `stampVersions`. */
export function toNodeRef(raw: Record<string, unknown>): NodeRef {
  const ref: NodeRef = { key: raw.key as string, type: raw.type as string };
  if (raw.name != null) ref.name = raw.name as string;
  if (raw.kind != null) ref.kind = raw.kind as string;
  if (raw.version != null) ref.version = raw.version as string;
  return ref;
}

/** Converte as propriedades de uma afirmação (Claim ou relação) em Fact. `propNames` são as do modelo para a relação. */
export function toFact(raw: Record<string, unknown>, propNames: readonly string[] = []): Fact {
  const fact: Fact = {
    source: raw.source as string,
    scope: raw.scopeKey ? (JSON.parse(raw.scopeKey as string) as Record<string, string>) : {},
    state: raw.state as string,
    status: raw.status as string,
    evidence: raw.evidence as string,
    observedAt: raw.observedAt as string,
    firstObservedAt: raw.firstObservedAt as string,
  };
  const props = Object.fromEntries(propNames.filter((p) => raw[p] != null).map((p) => [p, raw[p]]));
  if (Object.keys(props).length > 0) fact.props = props;
  return fact;
}

/** Propriedades do modelo que uma relação guarda, fora as de identidade (que ficam no Edge). */
function factPropNames(type: RelationType): string[] {
  const spec = relationSpec(type);
  return Object.keys(spec.props).filter((p) => !spec.identityProps.includes(p));
}

export type RelRow = { type: RelationType; node: Record<string, unknown>; rel: Record<string, unknown> };

/**
 * Agrupa afirmações paralelas: a mesma relação lógica (tipo, nó do outro lado e propriedades de identidade)
 * vira um Edge com um Fact por fonte e escopo. A ordem de chegada é mantida. `direction`, quando se sabe, é o
 * sentido visto do nó dono.
 */
export function groupEdges(rows: RelRow[], direction?: "out" | "in"): Edge[] {
  const byKey = new Map<string, Edge>();
  for (const { type, node, rel } of rows) {
    const spec = relationSpec(type);
    const identity = Object.fromEntries(spec.identityProps.map((p) => [p, rel[p] ?? null]));
    const k = JSON.stringify([type, node.key, identity]);
    let edge = byKey.get(k);
    if (!edge) {
      edge = { type, node: toNodeRef(node), ...(direction ? { direction } : {}), facts: [] };
      if (spec.identityProps.length > 0) edge.identity = identity;
      byKey.set(k, edge);
    }
    edge.facts.push(toFact(rel, factPropNames(type)));
  }
  return [...byKey.values()];
}

/** Uma afirmação de relação isolada (sem agrupar), com as propriedades do modelo. */
export function relFact(type: RelationType, rel: Record<string, unknown>): Fact {
  return toFact(rel, factPropNames(type));
}

/** Junta listas de Fact sem repetir a mesma afirmação (source, escopo, evidência). */
export function mergeFacts(into: Fact[], more: Fact[]): void {
  const seen = new Set(into.map(factId));
  for (const f of more) {
    const id = factId(f);
    if (!seen.has(id)) {
      seen.add(id);
      into.push(f);
    }
  }
}

function factId(f: Fact): string {
  return JSON.stringify([f.source, f.scope, f.evidence, f.props ?? null]);
}
