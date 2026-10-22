import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSeed } from "../src/graph-seed/seed";

const AT = "2026-10-03T12:00:00.000Z";

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "graph-seed-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe("graph-seed", () => {
  test("tipo pelo prefixo, propriedades no item e evidência herdada", () => {
    const plan = planSeed(
      dirWith({
        "org.yaml": `
snapshots:
  - source: directory
    scope: { tenant: x }
    evidenceBase: "https://dir/"
    evidence: export
    nodes:
      - { key: level:time, name: Time, order: 4, team: true, evidence: levels/time }
      - { key: group:time-a, name: Time A, evidence: groups/time-a }
      - { key: person:ana, name: Ana, email: ana@x.com }
    relations:
      - { type: AT_LEVEL, from: group:time-a, to: level:time, evidence: groups/time-a }
      - { type: MEMBER_OF, from: person:ana, to: group:time-a, role: Tech Lead }
`,
      }),
      AT,
    );
    expect(plan.errors).toEqual([]);
    const [s] = plan.snapshots;
    expect(s).toMatchObject({ source: "directory", scope: { tenant: "x" }, observedAt: AT, evidenceBase: "https://dir/" });
    expect(s.nodes).toEqual([
      { key: "level:time", type: "OrgLevel", props: { name: "Time", order: 4, team: true }, evidence: "levels/time" },
      { key: "group:time-a", type: "Group", props: { name: "Time A" }, evidence: "groups/time-a" },
      { key: "person:ana", type: "Person", props: { name: "Ana", email: "ana@x.com" }, evidence: "export" },
    ]);
    expect(s.relations).toEqual([
      { type: "AT_LEVEL", from: "group:time-a", to: "level:time", props: {}, evidence: "groups/time-a" },
      { type: "MEMBER_OF", from: "person:ana", to: "group:time-a", props: { role: "Tech Lead" }, evidence: "export" },
    ]);
  });

  test("vários retratos por arquivo e arquivos em ordem alfabética", () => {
    const plan = planSeed(
      dirWith({
        "b.yaml": `snapshots:\n  - { source: s2, scope: { env: prd }, evidence: e, nodes: [{ key: "resource:prd/db" }] }\n`,
        "a.yaml": `snapshots:\n  - { source: s1, scope: { env: dev }, evidence: e }\n  - { source: s1, scope: { env: stage }, evidence: e }\n`,
      }),
      AT,
    );
    expect(plan.snapshots.map((s) => `${s.file}:${s.source}:${s.scope.env}`)).toEqual(["a.yaml:s1:dev", "a.yaml:s1:stage", "b.yaml:s2:prd"]);
    expect(plan.snapshots[2].nodes[0].type).toBe("Resource");
  });

  test("recusa sem evidência, com prefixo desconhecido ou sem escopo", () => {
    const plan = planSeed(
      dirWith({
        "x.yaml": `
snapshots:
  - source: s
    scope: { a: b }
    nodes: [{ key: group:g }, { key: "foo:bar", evidence: e }]
    relations: [{ type: PART_OF, from: "group:g", to: "nada:x", evidence: e }]
  - { source: s, nodes: [] }
`,
      }),
      AT,
    );
    expect(plan.snapshots).toEqual([]);
    expect(plan.errors).toHaveLength(4);
    expect(plan.errors.join("\n")).toContain('nó "group:g" sem evidência');
    expect(plan.errors.join("\n")).toContain("prefixo da chave não é conhecido");
    expect(plan.errors.join("\n")).toContain("prefixo de chave desconhecido");
    expect(plan.errors.join("\n")).toContain('"source" e "scope" são obrigatórios');
  });
});

describe("carga da organização de exemplo (seeds/acme)", () => {
  const plan = planSeed(join(import.meta.dir, "..", "seeds", "acme"), AT);

  test("monta sem erros nem avisos", () => {
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(new Set(plan.snapshots.map((s) => s.source))).toEqual(
      new Set(["service-catalog", "service-config"]),
    );
  });

  test("toda chamada a endpoint cai num endpoint declarado, e toda API consumida é oferecida", () => {
    const rel = plan.snapshots.flatMap((s) => s.relations);
    const endpoints = new Set(plan.snapshots.flatMap((s) => s.nodes).filter((n) => n.type === "Endpoint").map((n) => n.key));
    const provided = new Set(rel.filter((r) => r.type === "PROVIDES").map((r) => r.to));
    expect(rel.filter((r) => r.type === "CALLS" && !endpoints.has(r.to)).map((r) => r.to)).toEqual([]);
    expect(rel.filter((r) => r.type === "CONSUMES" && !provided.has(r.to)).map((r) => r.to)).toEqual([]);
  });
});
