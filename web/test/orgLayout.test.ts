import { describe, expect, test } from "bun:test";
import { ORG_CARD_W, ORG_OWNS_ITEM_H, cardHeight, initials, isLead, memberships, orderedMembers, orgLayout, ownsByType, ownsKey } from "../src/lib/orgLayout";
import type { Edge, OrgNode } from "../src/lib/types";

const fact = (props?: Record<string, unknown>) => ({ source: "directory", evidence: "e", ...(props ? { props } : {}) });
const member = (key: string, props?: Record<string, unknown>): Edge => ({ type: "MEMBER_OF", node: { key, type: "Person", name: key }, direction: "in", facts: [fact(props)] });
const own = (key: string, type: string): Edge => ({ type: "OWNED_BY", node: { key, type }, direction: "in", facts: [fact()] });
const group = (key: string, groups: OrgNode[] = [], members: Edge[] = [], parent = true): OrgNode => ({
  key,
  type: "Group",
  status: "current",
  props: { name: key },
  referenced: false,
  aliases: [],
  facts: [fact()],
  ...(parent ? { parentFacts: [fact()] } : {}),
  level: [],
  members,
  owns: [],
  groups,
});

const at = (l: ReturnType<typeof orgLayout>, key: string) => l.cards.find((c) => c.key === key)!;

describe("organograma", () => {
  test("pai centrado sobre os filhos que têm subgrupos, lado a lado", () => {
    const tree = group("raiz", [group("a", [group("a1")]), group("b", [group("b1")])], [], false);
    const l = orgLayout([tree]);
    const [raiz, a, b] = ["raiz", "a", "b"].map((k) => at(l, k));
    expect(a.y).toBe(b.y);
    expect(a.y).toBeGreaterThan(raiz.y + raiz.height);
    expect(raiz.x + ORG_CARD_W / 2).toBeCloseTo((a.x + b.x + ORG_CARD_W) / 2);
    expect(l.links.filter((x) => x.from === "raiz").map((x) => x.kind)).toEqual(["tree", "tree"]);
  });

  test("só folhas: empilhadas sob o pai, recuadas, sem se sobrepor", () => {
    const tree = group("dept", [group("t1", [], [member("p1"), member("p2")]), group("t2")], [], false);
    const l = orgLayout([tree]);
    const [dept, t1, t2] = ["dept", "t1", "t2"].map((k) => at(l, k));
    expect(t1.x).toBe(t2.x);
    expect(t1.x).toBeGreaterThan(dept.x);
    expect(t2.y).toBeGreaterThan(t1.y + t1.height);
    expect(t1.height).toBe(cardHeight(t1.group));
    expect(l.links.map((x) => x.kind)).toEqual(["stack", "stack"]);
  });

  test("recolhido esconde a subárvore e conta os subgrupos escondidos", () => {
    const tree = group("raiz", [group("a"), group("b")], [], false);
    const l = orgLayout([tree], new Set(["raiz"]));
    expect(l.cards.map((c) => c.key)).toEqual(["raiz"]);
    expect(l.cards[0].hidden).toBe(2);
    expect(l.links).toEqual([]);
  });

  test("a aresta leva as afirmações do PART_OF; raízes lado a lado", () => {
    const l = orgLayout([group("r1", [group("c")], [], false), group("r2", [], [], false)]);
    expect(l.links).toEqual([{ id: "r1->c", from: "r1", to: "c", kind: "stack", facts: [fact()] }]);
    expect(at(l, "r2").x).toBeGreaterThan(at(l, "r1").x + ORG_CARD_W);
  });

  test("pessoa em mais de um grupo; líder só pelo que a fonte afirma, e primeiro", () => {
    const tree = group("raiz", [group("chapter", [], [member("bia")]), group("squad", [], [member("ana"), member("bia", { role: "UX", lead: false }), member("caio", { lead: true })])], [], false);
    expect(memberships([tree]).get("bia")).toEqual(["chapter", "squad"]);
    const squad = tree.groups[1];
    expect(squad.members.filter(isLead).map((m) => m.node.key)).toEqual(["caio"]);
    expect(orderedMembers(squad.members).map((m) => m.node.key)).toEqual(["caio", "ana", "bia"]);
  });

  test("posses por tipo, do mais amplo ao mais específico, sem as APIs", () => {
    const types = ownsByType([own("component:a", "Component"), own("domain:d", "Domain"), own("component:b", "Component"), own("api:x", "Api"), own("system:s", "System")]);
    expect(types.map((t) => `${t.edges.length} ${t.label}`)).toEqual(["1 domínio", "1 sistema", "2 componentes"]);
    expect(ownsByType([own("api:x", "Api")])).toEqual([]);
    expect(ownsByType([])).toEqual([]);
  });

  test("tipo de posse aberto aumenta o cartão e empurra os irmãos de baixo", () => {
    const t1 = { ...group("t1"), owns: [own("component:a", "Component"), own("component:b", "Component"), own("system:s", "System")] };
    const tree = group("dept", [t1, group("t2")], [], false);
    const open = new Set([ownsKey("t1", "Component")]);
    expect(cardHeight(t1, open) - cardHeight(t1)).toBe(2 * ORG_OWNS_ITEM_H);
    const [closed, opened] = [orgLayout([tree]), orgLayout([tree], new Set(), open)];
    expect(at(opened, "t2").y - at(closed, "t2").y).toBe(2 * ORG_OWNS_ITEM_H);
  });

  test("iniciais do nome", () => {
    expect(initials("Beatriz Santos")).toBe("BS");
    expect(initials("vinícius de araújo")).toBe("VA");
    expect(initials("Ana")).toBe("A");
  });
});
