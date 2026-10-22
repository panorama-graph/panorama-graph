import type { Edge, Fact, OrgNode } from "./types";

/**
 * Organograma: os grupos de cima para baixo, com as pessoas dentro do cartão do grupo. Os níveis de cima se abrem na
 * horizontal, com o pai centrado sobre os filhos; quando todos os filhos são folhas, eles se empilham na vertical
 * sob o pai, como no organograma clássico, para o desenho não ficar largo demais.
 */

export const ORG_CARD_W = 272;
export const ORG_HEADER_H = 58;
export const ORG_MEMBER_H = 40;
/** Título "É dono de" e, abaixo dele, uma linha por tipo (domínios, sistemas…) e uma por item dos tipos abertos. */
export const ORG_OWNS_TITLE_H = 24;
export const ORG_OWNS_TYPE_H = 26;
export const ORG_OWNS_ITEM_H = 26;
export const ORG_ROW_H = 30;
const PAD = 10;
const H_GAP = 28;
const ROOT_GAP = 72;
const V_GAP = 56;
const STACK_INDENT = 32;
/** Onde o tronco das arestas empilhadas sai do pai, a partir da borda esquerda (metade do recuo). */
export const ORG_STACK_TRUNK = STACK_INDENT / 2;
const STACK_TOP = 28;
const STACK_GAP = 16;

/** Como a aresta sai do pai: por baixo, para o filho ao lado dos irmãos, ou pelo canto, para o filho empilhado. */
export type OrgEdgeKind = "tree" | "stack";

export type OrgCard = {
  key: string;
  group: OrgNode;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  parent?: string;
  /** Subgrupos que o recolher esconde. */
  hidden: number;
};
export type OrgLink = { id: string; from: string; to: string; kind: OrgEdgeKind; facts: Fact[] };
export type OrgLayout = { cards: OrgCard[]; links: OrgLink[]; width: number; height: number };

/** Chave de um tipo de posse aberto no cartão (`?posses=`): o grupo e o tipo. */
export const ownsKey = (group: string, type: string) => `${group}~${type}`;

/**
 * Altura do cartão: cabeçalho, uma linha por membro (ou a de "sem membros"), as posses (uma linha por tipo, mais os
 * itens dos tipos abertos em `expanded`) e os subgrupos fora da profundidade.
 */
export function cardHeight(g: OrgNode, expanded: Set<string> = new Set()): number {
  const members = Math.max(g.members.length, 1) * ORG_MEMBER_H;
  const types = ownsByType(g.owns);
  const items = types.filter((t) => expanded.has(ownsKey(g.key, t.type))).reduce((n, t) => n + t.edges.length, 0);
  const owns = types.length > 0 ? ORG_OWNS_TITLE_H + types.length * ORG_OWNS_TYPE_H + items * ORG_OWNS_ITEM_H : 0;
  const more = g.moreGroups && g.moreGroups.length > 0 ? ORG_ROW_H : 0;
  return ORG_HEADER_H + members + owns + more + PAD;
}

/** Subárvore posicionada a partir de (0, 0); `rootX`: onde fica o cartão da raiz dela. */
type Placed = { cards: OrgCard[]; links: OrgLink[]; width: number; height: number; rootX: number };

function place(g: OrgNode, depth: number, collapsed: Set<string>, expanded: Set<string>, parent?: string): Placed {
  const height = cardHeight(g, expanded);
  const children = collapsed.has(g.key) ? [] : g.groups;
  const self: OrgCard = { key: g.key, group: g, depth, x: 0, y: 0, width: ORG_CARD_W, height, parent, hidden: collapsed.has(g.key) ? g.groups.length : 0 };
  if (children.length === 0) return { cards: [self], links: [], width: ORG_CARD_W, height, rootX: 0 };

  const sub = children.map((c) => place(c, depth + 1, collapsed, expanded, g.key));
  const link = (c: OrgNode, kind: OrgEdgeKind): OrgLink => ({ id: `${g.key}->${c.key}`, from: g.key, to: c.key, kind, facts: c.parentFacts ?? [] });
  const shift = (p: Placed, dx: number, dy: number) => p.cards.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));

  // Só folhas: empilhadas sob o pai, recuadas, com a aresta saindo do canto de baixo.
  if (sub.every((p) => p.cards.length === 1)) {
    const cards: OrgCard[] = [self];
    let y = height + STACK_TOP;
    for (const p of sub) {
      cards.push(...shift(p, STACK_INDENT, y));
      y += p.height + STACK_GAP;
    }
    return { cards, links: children.map((c) => link(c, "stack")), width: STACK_INDENT + ORG_CARD_W, height: y - STACK_GAP, rootX: 0 };
  }

  // Lado a lado, com o pai centrado sobre os cartões do primeiro e do último filho.
  const top = height + V_GAP;
  const cards: OrgCard[] = [];
  const offsets: number[] = [];
  let x = 0;
  for (const p of sub) {
    offsets.push(x);
    x += p.width + H_GAP;
  }
  const row = x - H_GAP;
  const rootX = (offsets[0] + sub[0].rootX + offsets[sub.length - 1] + sub[sub.length - 1].rootX) / 2;
  sub.forEach((p, i) => cards.push(...shift(p, offsets[i], top)));
  cards.unshift({ ...self, x: rootX });
  const links = [...children.map((c) => link(c, "tree")), ...sub.flatMap((p) => p.links)];
  return { cards, links, width: Math.max(row, rootX + ORG_CARD_W), height: top + Math.max(...sub.map((p) => p.height)), rootX };
}

/**
 * Posiciona as árvores lado a lado, a partir das raízes. `collapsed`: grupos com os subgrupos recolhidos;
 * `expanded`: tipos de posse abertos nos cartões (`ownsKey`).
 */
export function orgLayout(roots: OrgNode[], collapsed: Set<string> = new Set(), expanded: Set<string> = new Set()): OrgLayout {
  const cards: OrgCard[] = [];
  const links: OrgLink[] = [];
  let x = 0;
  let height = 0;
  for (const r of roots) {
    const p = place(r, 0, collapsed, expanded);
    cards.push(...p.cards.map((c) => ({ ...c, x: c.x + x })));
    links.push(...p.links);
    x += p.width + ROOT_GAP;
    height = Math.max(height, p.height);
  }
  return { cards, links, width: Math.max(0, x - ROOT_GAP), height };
}

/** Todos os grupos da árvore, de cima para baixo. */
export function flatten(roots: OrgNode[]): OrgNode[] {
  return roots.flatMap((g) => [g, ...flatten(g.groups)]);
}

/** Em que grupos cada pessoa aparece, para marcar quem está em mais de um (ex.: chapter e squad). */
export function memberships(roots: OrgNode[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const g of flatten(roots)) {
    for (const m of g.members) out.set(m.node.key, [...(out.get(m.node.key) ?? []), g.key]);
  }
  return out;
}

/** Quem lidera o grupo, só pelo que a fonte afirma (`lead` na filiação). */
export const isLead = (e: Edge) => e.facts.some((f) => f.props?.lead === true);

/** Os líderes primeiro, mantendo a ordem da API entre eles e entre os demais. */
export const orderedMembers = (members: Edge[]) => [...members.filter(isLead), ...members.filter((m) => !isLead(m))];

/** O que o organograma mostra do que o grupo possui: a estrutura (domínios, sistemas, componentes), sem as APIs. */
const OWN_TYPES: { type: string; one: string; many: string }[] = [
  { type: "Domain", one: "domínio", many: "domínios" },
  { type: "System", one: "sistema", many: "sistemas" },
  { type: "Component", one: "componente", many: "componentes" },
];

/** O que o grupo possui, por tipo e na ordem do mais amplo para o mais específico; os demais tipos ficam de fora. */
export function ownsByType(owns: Edge[]): { type: string; label: string; edges: Edge[] }[] {
  return OWN_TYPES.map((t) => ({ t, edges: owns.filter((e) => e.node.type === t.type) }))
    .filter((g) => g.edges.length > 0)
    .map(({ t, edges }) => ({ type: t.type, label: edges.length === 1 ? t.one : t.many, edges }));
}

/** Iniciais do nome, para o avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
