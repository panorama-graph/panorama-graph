import { describe, expect, test } from "vitest";
import { diverges, propValues, propsSummary } from "../src/lib/facts";
import type { Fact } from "../src/lib/types";

const f = (source: string, props?: Record<string, unknown>): Fact => ({ source, evidence: `${source}-ev`, ...(props ? { props } : {}) });

describe("propriedades por fonte", () => {
  test("valores iguais não divergem; quem não fala da propriedade não conta", () => {
    const facts = [f("sbom", { version: "3.2.4", direct: true }), f("dependency-usage", { used: true })];
    expect(diverges(facts)).toBe(false);
    expect(propsSummary(facts)).toBe("direct true; used true; version 3.2.4");
  });

  test("valores diferentes aparecem com as fontes", () => {
    const facts = [f("sbom", { version: "3.2.4" }), f("gitlab-ci", { version: "3.2.0" }), f("outra", { version: "3.2.4" })];
    expect(diverges(facts)).toBe(true);
    expect(propValues(facts)).toEqual([
      { prop: "version", values: [{ value: "3.2.4", sources: ["outra", "sbom"] }, { value: "3.2.0", sources: ["gitlab-ci"] }] },
    ]);
    expect(propsSummary(facts, ["version"])).toBe("version 3.2.4 (outra, sbom) · 3.2.0 (gitlab-ci)");
  });

  test("lista de valores simples vira texto separado por vírgula", () => {
    const facts = [f("sbom", { via: ["lib:maven/a:b", "lib:maven/c:d"], version: "1.0" })];
    expect(propsSummary(facts)).toBe("version 1.0; via lib:maven/a:b, lib:maven/c:d");
  });
});
