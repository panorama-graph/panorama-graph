import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { MODELO_PATH, renderModelo } from "../scripts/modelo";

describe("MODELO.md", () => {
  test("as tabelas são as do modelo atual (rode pnpm run modelo:write)", () => {
    const current = readFileSync(MODELO_PATH, "utf8");
    expect(renderModelo(current)).toBe(current);
  });
});
