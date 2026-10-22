import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { plan } from "../src/plan";

/** Os exports da organização de exemplo (ACME Bank), que a carga de exemplo do compose envia. */
describe("exports da organização de exemplo (data/acme)", () => {
  const { snapshots, errors } = plan(join(import.meta.dir, "..", "data", "acme"), "2026-10-01T00:00:00Z");
  const org = snapshots.find((s) => s.source === "directory")!;

  test("traduzem sem erros, e cada ambiente tem os seus retratos", () => {
    expect(errors).toEqual([]);
    expect(snapshots.map((s) => `${s.source} ${s.scope?.namespace ?? s.scope?.tenant}`)).toEqual([
      "directory acme",
      "k8s-infra dev", "k8s-routes dev",
      "k8s-infra stage", "k8s-routes stage",
      "k8s-infra prd", "k8s-routes prd",
    ]);
  });

  test("todo grupo tem nível e pai, menos as diretorias, e todo grupo com membros tem quem o lidera", () => {
    const levelOf = new Map(org.relations!.filter((r) => r.type === "AT_LEVEL").map((r) => [r.from, r.to]));
    const groups = org.nodes!.filter((n) => n.type === "Group");
    expect(groups.filter((g) => !levelOf.has(g.key))).toEqual([]);
    const children = new Set(org.relations!.filter((r) => r.type === "PART_OF").map((r) => r.from));
    const orphans = groups.filter((n) => levelOf.get(n.key) !== "level:diretoria" && !children.has(n.key));
    expect(orphans).toEqual([]);
    const members = org.relations!.filter((r) => r.type === "MEMBER_OF");
    const led = new Set(members.filter((r) => r.props?.lead === true).map((r) => r.to));
    expect([...new Set(members.map((r) => r.to))].filter((g) => !led.has(g))).toEqual([]);
  });

  test("a estrutura tem os quatro níveis, de diretoria a time, e só o nível de time é de times", () => {
    const levelOf = new Map(org.relations!.filter((r) => r.type === "AT_LEVEL").map((r) => [r.from, r.to]));
    const parentOf = new Map(org.relations!.filter((r) => r.type === "PART_OF").map((r) => [r.from, r.to]));
    const chain = (g: string): string[] => [levelOf.get(g)!, ...(parentOf.has(g) ? chain(parentOf.get(g)!) : [])];
    expect(chain("group:squad-pix")).toEqual(["level:time", "level:tribo", "level:superintendencia", "level:diretoria"]);
    const teams = org.nodes!.filter((n) => n.type === "OrgLevel" && n.props?.team === true).map((n) => n.key);
    expect(teams).toEqual(["level:time"]);
  });

  // O resto da carga de exemplo está no projeto ao lado: o YAML do graph-seed (catálogo, configuração e build) e os
  // artefatos de build que o graph-publish envia. Numa cópia deste projeto fora do monorepo, eles não existem, e a
  // conferência não se aplica.
  const adapters = join(import.meta.dir, "..", "..", "adapters");
  const seeds = join(adapters, "seeds", "acme");
  const builds = join(adapters, "test", "fixtures");
  test.skipIf(!existsSync(seeds))("todo dono do catálogo e todo componente roteado existem nas outras cargas", () => {
    const groups = new Set(org.nodes!.map((n) => n.key));
    const yaml = readdirSync(seeds).flatMap(
      (f) => ((Bun.YAML.parse(readFileSync(join(seeds, f), "utf8")) as { snapshots?: any[] })?.snapshots ?? []) as any[],
    );
    const catalog = yaml.find((s) => s.source === "service-catalog");
    const owners: string[] = catalog.relations.filter((r: any) => r.type === "OWNED_BY").map((r: any) => r.to);
    expect(owners.filter((g) => !groups.has(g))).toEqual([]);

    const built = readdirSync(builds).map((d) => {
      const { component } = JSON.parse(readFileSync(join(builds, d, "manifest.json"), "utf8"));
      return `component:${new URL(component.repository).pathname.slice(1).replace(/\.git$/, "")}`;
    });
    const declared = yaml.flatMap((s) => (s.nodes ?? []).map((n: any) => n.key as string)).filter((k) => k.startsWith("component:"));
    const components = new Set([...declared, ...built]);
    const routed = snapshots.flatMap((s) => s.relations ?? []).filter((r) => r.type === "ROUTES" || r.type === "INSTANCE_OF").map((r) => r.to);
    expect([...new Set(routed)].filter((c) => !components.has(c))).toEqual([]);
  });
});
