import { describe, expect, test } from "vitest";
import { checkKey } from "../src/model/keys";
import { isValidPair, nodeProps, validateProps } from "../src/model/model";
import { canonicalScope, validateSnapshot, type IngestBody } from "../src/ingest/payload";

const base = (over: Partial<IngestBody> = {}): IngestBody => ({
  source: "gitlab",
  scope: {},
  observedAt: "2026-09-29T10:00:00Z",
  evidenceBase: "gitlab:",
  nodes: [],
  relations: [],
  ...over,
});

describe("chaves", () => {
  test("prefixo determina o tipo", () => {
    expect(checkKey("component:acme/credito/product-catalog-api")).toEqual({ ok: true, type: "Component" });
    expect(checkKey("endpoint:product-catalog-api/GET /products/{id}")).toEqual({ ok: true, type: "Endpoint" });
    expect(checkKey("repo:gitlab/acme/x")).toEqual({ ok: true, type: "Repository" });
  });

  test("recusa formato inválido", () => {
    expect(checkKey("product-catalog-api").ok).toBe(false);
    expect(checkKey("widget:x").ok).toBe(false);
    expect(checkKey("component:").ok).toBe(false);
    expect(checkKey("component: x").ok).toBe(false);
    expect(checkKey("component:x\n").ok).toBe(false);
  });
});

describe("modelo", () => {
  test("pares válidos", () => {
    expect(isValidPair("CONSUMES", "Component", "Api")).toBe(true);
    expect(isValidPair("CONSUMES", "Api", "Component")).toBe(false);
    expect(isValidPair("HOSTED_ON", "Topic", "Resource")).toBe(true);
  });

  test("propriedades por tipo", () => {
    expect(validateProps(nodeProps("Component"), { kind: "service", name: "x" }, "n")).toEqual([]);
    expect(validateProps(nodeProps("Component"), { kind: "robot" }, "n")[0]).toContain("deve ser um de");
    expect(validateProps(nodeProps("Domain"), { owner: "x" }, "n")[0]).toContain("desconhecida");
  });

  test("nível organizacional: posição numérica, time por marcador e grupo sem kind (v12)", () => {
    expect(validateProps(nodeProps("OrgLevel"), { name: "Tribo", order: 3 }, "n")).toEqual([]);
    expect(validateProps(nodeProps("OrgLevel"), { name: "Time", order: 4, team: true }, "n")).toEqual([]);
    expect(validateProps(nodeProps("OrgLevel"), { order: "3" }, "n")).toEqual(['n: "order" deve ser number']);
    expect(validateProps(nodeProps("Group"), { kind: "team" }, "n")[0]).toContain("desconhecida");
    expect(isValidPair("AT_LEVEL", "Group", "OrgLevel")).toBe(true);
    expect(isValidPair("AT_LEVEL", "Person", "OrgLevel")).toBe(false);
    expect(checkKey("level:tribo")).toEqual({ ok: true, type: "OrgLevel" });
  });

  test("escopo canônico independe da ordem", () => {
    expect(canonicalScope({ b: "2", a: "1" })).toBe(canonicalScope({ a: "1", b: "2" }));
  });
});

describe("validateSnapshot", () => {
  test("aceita carga coerente e combina evidência", () => {
    const v = validateSnapshot(
      base({
        nodes: [{ key: "component:a", type: "Component", props: { kind: "service" }, evidence: "a" }],
        relations: [{ type: "CONSUMES", from: "component:a", to: "api:b/http" }],
      }),
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.snapshot.nodes[0].evidence).toBe("gitlab:a");
      expect(v.snapshot.relations[0].evidence).toBe("gitlab:");
    }
  });

  test("recusa sem evidência, par inválido, tipo desconhecido e chave incoerente", () => {
    const v = validateSnapshot(
      base({
        evidenceBase: undefined,
        nodes: [
          { key: "component:a", type: "Component" },
          { key: "component:b", type: "Api", evidence: "x" },
          { key: "x:c", type: "Widget", evidence: "x" },
        ],
        relations: [{ type: "CONSUMES", from: "api:b/http", to: "component:a", evidence: "x" }],
      }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.some((e) => e.includes("sem evidência"))).toBe(true);
      expect(v.errors.some((e) => e.includes("a chave é de Component"))).toBe(true);
      expect(v.errors.some((e) => e.includes("tipo de nó desconhecido"))).toBe(true);
      expect(v.errors.some((e) => e.includes("pares válidos"))).toBe(true);
    }
  });

  test("recusa campo reservado e relação repetida", () => {
    const rel = { type: "CONSUMES", from: "component:a", to: "api:b/http", props: { source: "x" } };
    const v = validateSnapshot(base({ relations: [rel, rel] }));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.some((e) => e.includes("reservado"))).toBe(true);
      expect(v.errors.some((e) => e.includes("repetida"))).toBe(true);
    }
  });

  test("ROUTES distingue por host e path", () => {
    const r = (path: string) => ({
      type: "ROUTES",
      from: "resource:dev/ingress",
      to: "component:a",
      props: { host: "a.dev", path },
    });
    expect(validateSnapshot(base({ relations: [r("/a"), r("/b")] })).ok).toBe(true);
    expect(validateSnapshot(base({ relations: [r("/a"), r("/a")] })).ok).toBe(false);
  });
});
