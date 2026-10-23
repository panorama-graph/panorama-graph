import { describe, expect, test } from "vitest";
import { levelOf, levelStyles } from "../src/lib/orgLevels";
import type { NodeView, OrgNode } from "../src/lib/types";

const level = (key: string, props: Record<string, unknown>): NodeView => ({ key, type: "OrgLevel", status: "current", props, referenced: false, aliases: [], facts: [] });
const group = (levelKey?: string): OrgNode => ({
  key: "group:g",
  type: "Group",
  status: "current",
  props: {},
  referenced: false,
  aliases: [],
  facts: [],
  level: levelKey ? [{ type: "AT_LEVEL", node: { key: levelKey, type: "OrgLevel" }, direction: "out", facts: [] }] : [],
  members: [],
  owns: [],
  groups: [],
});

describe("níveis do organograma", () => {
  const styles = levelStyles([
    level("level:diretoria", { name: "Diretoria", order: 1 }),
    level("level:superintendencia", { name: "Superintendência", order: 2 }),
    level("level:tribo", { name: "Tribo", order: 3 }),
    level("level:chapter", { name: "Chapter", order: 3 }),
    level("level:time", { name: "Time", order: 4, team: true }),
  ]);

  test("cada posição tem a sua cor; o nível lateral repete a do vizinho; o time tem cor própria", () => {
    const color = (k: string) => styles.get(k)!.color;
    expect(new Set(["level:diretoria", "level:superintendencia", "level:tribo", "level:time"].map(color)).size).toBe(4);
    expect(color("level:chapter")).toBe(color("level:tribo"));
    expect(styles.get("level:time")).toMatchObject({ label: "Time", team: true });
    expect(levelStyles([level("level:squad", { name: "Squad", order: 2, team: true })]).get("level:squad")!.color).toBe(color("level:time"));
  });

  test("o grupo leva o rótulo do nível; sem nível, é só grupo", () => {
    expect(levelOf(group("level:tribo"), styles).label).toBe("Tribo");
    expect(levelOf(group(), styles)).toMatchObject({ label: "Grupo", team: false });
    expect(levelOf(group("level:desconhecido"), styles).label).toBe("Grupo");
  });

  test("nível sem nome usa o identificador; sem posição, a cor neutra", () => {
    const s = levelStyles([level("level:area", {})]);
    expect(s.get("level:area")!.label).toBe("area");
    expect(s.get("level:area")!.color).toBe(levelOf(group(), s).color);
  });
});
