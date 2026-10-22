import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PanoramaGraphClient } from "@panorama-graph/sdk";
import { PRODUCER } from "../src/core/producer";
import type { Snapshot } from "../src/core/snapshot";
import { imageTag, planDeployments, type K8sDeployment, type K8sNamespace, type K8sService } from "../src/graph-deployments/deployments";
import { publishDeployments } from "../src/graph-deployments/publish";

const observedAt = "2026-10-18T12:00:00.000Z";
const CATALOG = "acme/credito/product-catalog-api";

const deployment = (ns: string, name: string, opts: { component?: string; commit?: string; version?: string; image?: string; replicas?: number } = {}): K8sDeployment => ({
  metadata: {
    name,
    namespace: ns,
    labels: opts.version ? { "app.kubernetes.io/version": opts.version } : {},
    annotations: {
      ...(opts.component ? { "panorama-graph.io/component": opts.component } : {}),
      ...(opts.commit ? { "panorama-graph.io/commit": opts.commit } : {}),
    },
  },
  spec: { replicas: opts.replicas, template: { spec: { containers: [{ image: opts.image ?? `registry:5000/${name}:latest` }] } } },
});
const namespace = (name: string, labels: Record<string, string> = {}): K8sNamespace => ({ metadata: { name, labels } });

const cluster = {
  deployments: {
    items: [
      deployment("dev", "product-catalog-api", { component: CATALOG, commit: "aaa111", version: "1.1.0-SNAPSHOT", image: "registry.acmebank.example:5000/pca:1.1.0-SNAPSHOT-aaa111", replicas: 1 }),
      deployment("dev", "apicurio-registry"),
      deployment("dev", "sem-commit", { component: "acme/credito/sem-commit" }),
      // Canário em prd: duas versões do mesmo componente.
      deployment("prd", "product-catalog-api", { component: CATALOG, commit: "bbb222", image: "registry.acmebank.example:5000/pca:1.0.0" }),
      deployment("prd", "product-catalog-api-canary", { component: CATALOG, commit: "ccc333", version: "1.1.0", replicas: 1 }),
    ],
  },
  namespaces: {
    items: [
      namespace("dev", { "panorama-graph.io/environment": "dev", "panorama-graph.io/environment-kind": "development" }),
      namespace("prd", { "panorama-graph.io/environment-kind": "production" }),
      namespace("stage", { "panorama-graph.io/environment": "stage", "panorama-graph.io/environment-kind": "staging" }),
      namespace("kube-system"),
    ],
  },
};

describe("implantações lidas do cluster", () => {
  test("tag da imagem, com registry de porta e com digest", () => {
    expect(imageTag("registry.acmebank.example:5000/acme/pca:1.0.0")).toBe("1.0.0");
    expect(imageTag("registry.acmebank.example:5000/acme/pca")).toBeUndefined();
    expect(imageTag("registry/pca:2.1@sha256:abc")).toBe("2.1");
  });

  test("um retrato por ambiente, um DEPLOYED_IN por componente e commit, e o resto ignorado", () => {
    const plan = planDeployments(cluster.deployments, cluster.namespaces, { cluster: "acme", observedAt });
    expect(plan.ignored).toBe(1);
    expect(plan.warnings).toEqual(["dev/sem-commit: sem a anotação panorama-graph.io/commit; implantação ignorada"]);
    expect(plan.snapshots.map((s) => s.scope)).toEqual([
      { cluster: "acme", namespace: "dev" },
      { cluster: "acme", namespace: "prd" },
      { cluster: "acme", namespace: "stage" },
    ]);

    const [dev, prd, stage] = plan.snapshots;
    expect(dev).toMatchObject({ source: "k8s-deployments", evidenceBase: "k8s://acme/dev/" });
    expect(dev.nodes).toEqual([{ key: "env:dev", type: "Environment", props: { name: "dev", kind: "development" }, evidence: "namespace/dev" }]);
    expect(dev.relations).toEqual([
      {
        type: "DEPLOYED_IN",
        from: `component:${CATALOG}`,
        to: "env:dev",
        props: { version: "1.1.0-SNAPSHOT", commit: "aaa111", image: "registry.acmebank.example:5000/pca:1.1.0-SNAPSHOT-aaa111", replicas: "1" },
        evidence: "deployment/product-catalog-api",
      },
    ]);
    // Sem o label de ambiente, o nome do namespace; sem o label de versão, a tag da imagem.
    expect(prd.nodes[0]).toMatchObject({ key: "env:prd", props: { name: "prd", kind: "production" } });
    expect(prd.relations.map((r) => [r.props?.commit, r.props?.version])).toEqual([
      ["bbb222", "1.0.0"],
      ["ccc333", "1.1.0"],
    ]);
    // Ambiente marcado sem implantação: retrato vazio, para o que saiu dele virar histórico.
    expect(stage.relations).toEqual([]);
  });

  test("--namespace restringe aos namespaces pedidos", () => {
    const plan = planDeployments(cluster.deployments, cluster.namespaces, { cluster: "acme", observedAt, namespaces: ["prd"] });
    expect(plan.snapshots.map((s) => s.scope.namespace)).toEqual(["prd"]);
    expect(plan.warnings).toEqual([]);
  });
});

/** Pacote como o CI publica: tar.gz do conteúdo de build/architecture. */
function bundleOf(fixture: string): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "bundle-"));
  const file = join(dir, "architecture.tar.gz");
  const tar = Bun.spawnSync(["tar", "-czf", file, "-C", join(import.meta.dir, "fixtures", fixture), "."]);
  if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
  return readFileSync(file);
}

type ScopeProducer = { name: string; version: string } | undefined;

/**
 * Publica as implantações da fixture contra uma API falsa que já tem o retrato congelado do ccc333 (um escopo por
 * produtor dado) e um Nexus com o pacote dos commits em `bundles`.
 */
async function publishWith(ccc333: ScopeProducer[], bundles: string[]) {
  const sent: Snapshot[] = [];
  const counts = { nodes: {}, relations: {}, referenced: 0 };
  const client = new PanoramaGraphClient({
    baseUrl: "http://api",
    fetch: async (url, init) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (String(url).endsWith("/v1/queries/sources_status")) {
        return json({
          sources: ccc333.map((producer, i) => ({
            source: `fonte-${i}`,
            lastObservedAt: observedAt,
            scopeCount: 1,
            scopes: [
              {
                scope: { component: CATALOG, commit: "ccc333" },
                lastObservedAt: observedAt,
                revision: { component: `component:${CATALOG}`, commit: "ccc333", frozen: true },
                ...(producer ? { producer } : {}),
              },
            ],
          })),
          loads: [],
          coverage: [],
        });
      }
      sent.push(JSON.parse(String(init?.body)) as Snapshot);
      return json({ loadId: "l", source: "x", scope: {}, observedAt, counts });
    },
  });
  const bundle = bundleOf("product-catalog-api");
  const requested: string[] = [];
  const log: string[] = [];
  const plan = planDeployments(cluster.deployments, cluster.namespaces, { cluster: "acme", observedAt });
  const result = await publishDeployments(plan, {
    client,
    bundleUrlTemplate: "http://nexus/repository/architecture/{component}/{commit}.tar.gz",
    observedAt,
    log: (l) => log.push(l),
    fetch: (async (url: string) => {
      requested.push(url);
      return bundles.some((c) => url.includes(c)) ? new Response(bundle) : new Response("", { status: 404 });
    }) as typeof fetch,
  });
  return { result, sent, requested, log };
}

describe("publicação das implantações", () => {
  test("congela os commits que a API não tem, antes de publicar as implantações", async () => {
    const { result, sent, requested, log } = await publishWith([PRODUCER], ["aaa111"]);

    expect(requested).toEqual([
      `http://nexus/repository/architecture/${CATALOG}/aaa111.tar.gz`,
      `http://nexus/repository/architecture/${CATALOG}/bbb222.tar.gz`,
    ]);
    expect(result).toEqual({ frozen: [`${CATALOG}@aaa111`], refrozen: [], missing: [`${CATALOG}@bbb222`], alreadyFrozen: [`${CATALOG}@ccc333`], failed: false });
    expect(log.some((l) => l.includes("bbb222: sem pacote de artefatos"))).toBe(true);

    const frozen = sent.filter((s) => s.source !== "k8s-deployments");
    const deployments = sent.filter((s) => s.source === "k8s-deployments");
    expect(sent.indexOf(deployments[0])).toBe(frozen.length);
    expect(frozen.length).toBeGreaterThan(3);
    for (const s of frozen) {
      expect(s.scope).toEqual({ component: CATALOG, commit: "aaa111" });
      expect(s.revision).toEqual({ component: `component:${CATALOG}`, commit: "aaa111", version: "1.1.0-SNAPSHOT" });
      expect(s.evidenceBase).toBe(`${CATALOG}@aaa111:`);
      expect(s.producer).toEqual({ ...PRODUCER });
    }
    expect(deployments.map((s) => s.scope.namespace)).toEqual(["dev", "prd", "stage"]);
  });

  test("refaz o retrato congelado montado por uma versão mais antiga dos adaptadores", async () => {
    const { result, sent, log } = await publishWith([PRODUCER, { name: PRODUCER.name, version: "0.0.1" }], ["aaa111", "ccc333"]);
    expect(result.refrozen).toEqual([`${CATALOG}@ccc333`]);
    expect(result.alreadyFrozen).toEqual([]);
    expect(log.some((l) => l.includes("ccc333") && l.includes("refazendo (montado pela versão 0.0.1)"))).toBe(true);
    expect(sent.some((s) => s.scope.commit === "ccc333")).toBe(true);
  });

  test("refaz o retrato montado antes de os adaptadores informarem a versão; o de outro produtor não conta", async () => {
    expect((await publishWith([undefined], ["aaa111", "ccc333"])).result.refrozen).toEqual([`${CATALOG}@ccc333`]);
    const other = await publishWith([{ name: "outro-produtor", version: "0.0.1" }], ["aaa111", "ccc333"]);
    expect(other.result.alreadyFrozen).toEqual([`${CATALOG}@ccc333`]);
  });

  test("sem o pacote para refazer, fica o retrato que existe", async () => {
    const { result, log } = await publishWith([{ name: PRODUCER.name, version: "0.0.1" }], ["aaa111"]);
    expect(result.refrozen).toEqual([]);
    expect(result.alreadyFrozen).toEqual([`${CATALOG}@ccc333`]);
    expect(result.missing).toEqual([`${CATALOG}@bbb222`]);
    expect(log.some((l) => l.includes("ccc333") && l.includes("fica o retrato montado pela versão 0.0.1"))).toBe(true);
  });
});

describe("versões expostas na infraestrutura", () => {
  const STOCK = "example/stock/stock-api";
  const withPods = (d: K8sDeployment, labels: Record<string, string>): K8sDeployment => ({
    ...d,
    spec: { ...d.spec, template: { ...d.spec?.template, metadata: { labels } } },
  });
  const service = (ns: string, name: string, selector?: Record<string, string>): K8sService => ({ metadata: { name, namespace: ns }, spec: { selector } });
  const deployments = {
    items: [
      withPods(deployment("prd", "stock-api-v2", { component: STOCK, commit: "a2", version: "2.4.0" }), { app: "stock-api", track: "v2" }),
      withPods(deployment("prd", "stock-api-v3", { component: STOCK, commit: "a3", version: "3.0.1" }), { app: "stock-api", track: "v3" }),
    ],
  };
  const services = {
    items: [
      service("prd", "stock-api-v2", { app: "stock-api", track: "v2" }),
      service("prd", "stock-api-v3", { app: "stock-api", track: "v3" }),
      service("prd", "stock-api", { app: "stock-api" }), // sem versão no nome: a API do código
      service("prd", "mongodb-v7", { app: "mongodb" }), // não seleciona componente
      service("prd", "headless-v1"), // sem seletor
    ],
  };

  test("o Service com a versão no nome vira a API daquela versão, oferecida pelo componente e ligada à API do código", () => {
    const plan = planDeployments(deployments, { items: [namespace("prd")] }, { cluster: "acme", observedAt, services });
    const [snap] = plan.snapshots;
    expect(snap.nodes.filter((n) => n.type === "Api")).toEqual([
      { key: "api:stock-api/v2/http", type: "Api", props: { name: "stock-api-v2", kind: "http", version: "v2" }, evidence: "service/stock-api-v2" },
      { key: "api:stock-api/v3/http", type: "Api", props: { name: "stock-api-v3", kind: "http", version: "v3" }, evidence: "service/stock-api-v3" },
    ]);
    const rels = (type: string) => snap.relations.filter((r) => r.type === type).map((r) => [r.from, r.to]);
    expect(rels("PROVIDES")).toEqual([
      [`component:${STOCK}`, "api:stock-api/v2/http"],
      [`component:${STOCK}`, "api:stock-api/v3/http"],
    ]);
    expect(rels("VERSION_OF")).toEqual([
      ["api:stock-api/v2/http", "api:stock-api/http"],
      ["api:stock-api/v3/http", "api:stock-api/http"],
    ]);
    expect(plan.exposed.map((e) => e.name)).toEqual(["stock-api-v2", "stock-api-v3"]);
  });

  test("sem os Services, só as implantações", () => {
    const plan = planDeployments(deployments, { items: [namespace("prd")] }, { cluster: "acme", observedAt });
    expect(plan.snapshots[0].nodes.some((n) => n.type === "Api")).toBe(false);
    expect(plan.exposed).toEqual([]);
  });
});
