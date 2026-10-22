import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADAPTADOR_PATH, RELATION_GUIDE, exampleSnapshot, renderAdaptador } from "../scripts/adaptador";
import { ingestBodySchema, validateSnapshot } from "../src/ingest/payload";
import { checkKey } from "../src/model/keys";
import { RELATION_TYPE_NAMES, relationSpec } from "../src/model/model";

describe("ADAPTADOR.md", () => {
  test("o catálogo de relações é o do modelo atual (rode bun run adaptador:write)", () => {
    const current = readFileSync(ADAPTADOR_PATH, "utf8");
    expect(renderAdaptador(current)).toBe(current);
  });

  test.each(RELATION_TYPE_NAMES.map((t) => [t]))("o exemplo de %s passa na validação do POST /v1/ingest", (type) => {
    const v = validateSnapshot(ingestBodySchema.parse(exampleSnapshot(type)));
    expect(v.ok ? [] : v.errors).toEqual([]);
    expect(RELATION_GUIDE[type].relations.some((r) => r.type === type)).toBe(true);
  });

  test("os exemplos cobrem todos os pares de todas as relações", () => {
    const seen = new Set<string>();
    for (const type of RELATION_TYPE_NAMES) {
      for (const r of RELATION_GUIDE[type].relations) {
        const from = checkKey(r.from);
        const to = checkKey(r.to);
        if (from.ok && to.ok) seen.add(`${r.type} ${from.type}→${to.type}`);
      }
    }
    const missing = RELATION_TYPE_NAMES.flatMap((type) =>
      relationSpec(type).pairs.map(([f, t]) => `${type} ${f}→${t}`).filter((p) => !seen.has(p)),
    );
    expect(missing).toEqual([]);
  });
});
