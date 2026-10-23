import { describe, expect, test } from "vitest";
import { relationSpec, validateProps } from "../src/model/model";
import type { Edge, Fact } from "../src/query/facts";
import { libraryUse, versionsInUse } from "../src/query/libraries";

const fact = (source: string, props: Record<string, unknown>): Fact =>
  ({ source, evidence: "x", props, status: "current", state: "observed", observedAt: "2026-10-21T00:00:00Z" }) as Fact;
const use = (component: string, ...facts: Fact[]): Edge =>
  ({ type: "DEPENDS_ON", node: { key: component, type: "Component" }, facts }) as Edge;

describe("uso de biblioteca", () => {
  test("direta quando alguma fonte diz; transitiva só quando nenhuma diz", () => {
    expect(libraryUse(use("c", fact("sbom", { direct: false }), fact("dependency-usage", { declared: true }))).direct).toBe(true);
    expect(libraryUse(use("c", fact("sbom", { direct: false, via: ["lib:b", "lib:a"] }))).via).toEqual(["lib:a", "lib:b"]);
    // Sem informação, conta como direta: não some do recorte padrão.
    expect(libraryUse(use("c", fact("manual", { version: "1.0" }))).direct).toBe(true);
  });

  test("a versão resolvida vence a declarada", () => {
    const u = libraryUse(use("c", fact("build-manifest", { version: "1.+" }), fact("sbom", { version: "1.4.2", resolved: true })));
    expect(u.version).toBe("1.4.2");
  });

  test("declarada e sem uso; usada por alguma fonte não é sem uso", () => {
    expect(libraryUse(use("c", fact("dependency-usage", { declared: true, used: false }))).unused).toBe(true);
    expect(libraryUse(use("c", fact("dependency-usage", { declared: true, used: true }))).unused).toBeUndefined();
  });

  test("versões em uso, da mais nova para a mais antiga, sem versão por último", () => {
    const uses = [
      libraryUse(use("a", fact("sbom", { version: "2.10.0" }))),
      libraryUse(use("b", fact("sbom", { version: "2.9.1" }))),
      libraryUse(use("c", fact("sbom", { version: "2.10.0" }))),
      libraryUse(use("d", fact("dependency-usage", { declared: true }))),
    ];
    expect(versionsInUse(uses)).toEqual([
      { version: "2.10.0", components: ["a", "c"] },
      { version: "2.9.1", components: ["b"] },
      { version: null, components: ["d"] },
    ]);
  });
});

test("via é lista de textos", () => {
  const specs = relationSpec("DEPENDS_ON").props;
  expect(validateProps(specs, { via: ["lib:a"] }, "r")).toEqual([]);
  expect(validateProps(specs, { via: "lib:a" }, "r")).toEqual(['r: "via" deve ser lista de textos']);
  expect(validateProps(specs, { via: [1] }, "r")).toEqual(['r: "via" deve ser lista de textos']);
});
