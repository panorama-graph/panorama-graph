import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { QueryService } from "../src/query/QueryService";
import { K, loadAcme, type Load } from "./fixtures/acme";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

const db = createTestDb();
const q = new QueryService(db);
let app: FastifyInstance;

/** Um framework interno de vários módulos: o repositório gera o pacote da biblioteca e um de testes. */
const FRAMEWORK = "component:example/platform/framework";
const TEST_LIB = "lib:maven/br.com.acme:service-platform-test";

const frameworkManifest: Load = {
  source: "build-manifest",
  scope: { component: "example/platform/framework" },
  evidenceBase: "example/platform/framework@abc123:build/architecture/manifest.json",
  producer: { name: "graph-publish", version: "0.2.0" },
  nodes: [
    { key: FRAMEWORK, type: "Component", props: { name: "framework", kind: "library" } },
    { key: TEST_LIB, type: "Library", props: { name: "br.com.acme:service-platform-test" } },
  ],
  relations: [
    { type: "PRODUCES", from: FRAMEWORK, to: K.platform, props: { version: "3.0.0" } },
    { type: "PRODUCES", from: FRAMEWORK, to: TEST_LIB, props: { version: "3.0.0" } },
  ],
};

let clock = Date.UTC(2026, 9, 1, 9, 0, 0);
async function ingest(load: Load) {
  const res = await app.inject({ method: "POST", url: "/v1/ingest", payload: { ...load, observedAt: new Date((clock += 1000)).toISOString() } });
  if (res.statusCode >= 300) throw new Error(`carga falhou: ${res.body}`);
}

beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger });
  await resetDatabase(db);
  await loadAcme(async (method, url, payload) => {
    const res = await app.inject({ method, url, payload: payload as Record<string, unknown> });
    return { statusCode: res.statusCode, body: res.body };
  }, Date.UTC(2026, 8, 29, 9, 0, 0));
  await ingest(frameworkManifest);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("componente que gera bibliotecas", () => {
  test("pelo componente: os pacotes que ele gera e quem usa cada um", async () => {
    const res = await q.libraryUsage(FRAMEWORK);
    expect(res.library.key).toBe(FRAMEWORK);
    expect(res.packages!.map((p) => p.node.key).sort()).toEqual([K.platform, TEST_LIB].sort());
    expect(res.packages!.find((p) => p.node.key === K.platform)!.facts[0].props).toEqual({ version: "3.0.0" });
    // Ninguém usa o pacote de testes: os usos são os da biblioteca, cada um com o pacote.
    expect(res.users.map((u) => [u.node.key, u.library]).sort()).toEqual([
      [K.lsa, K.platform],
      [K.pca, K.platform],
    ]);
    expect(res.versions.map((v) => v.version)).toEqual(["3.0.0-RC1", "2.3.1"]);
    expect(res.producedBy).toBeUndefined();
  });

  test("a ficha do componente traz os pacotes que ele gera", async () => {
    const framework = await q.componentGet(FRAMEWORK);
    expect(framework.packages.map((p) => p.node.key).sort()).toEqual([K.platform, TEST_LIB].sort());
    expect((await q.componentGet(K.pca)).packages).toEqual([]);
  });

  test("na visão geral, quem usa liga ao componente que gera a biblioteca; as de terceiros ficam de fora", async () => {
    const all = await q.architectureOverview();
    const links = all.libraryLinks.map((l) => [l.from, l.to, l.packages.map((p) => `${p.key}@${p.version}`)]).sort();
    expect(links).toEqual(
      [
        [K.lsa, FRAMEWORK, [`${K.platform}@3.0.0-RC1`]],
        [K.pca, FRAMEWORK, [`${K.platform}@2.3.1`]],
      ].sort(),
    );
    // Na vizinhança do framework, quem usa o que ele gera; na de um serviço, o que ele usa.
    expect((await q.architectureOverview({ component: FRAMEWORK })).libraryLinks.map((l) => l.from).sort()).toEqual([K.lsa, K.pca].sort());
    const pca = (await q.architectureOverview({ component: K.pca })).libraryLinks;
    expect(pca.filter((l) => l.from === K.pca).map((l) => l.to)).toEqual([FRAMEWORK]);
  });

  test("os filtros valem para o componente", async () => {
    const res = await q.libraryUsage(FRAMEWORK, { versionRange: ">=3.0.0-RC1" });
    expect(res.users.map((u) => u.node.key)).toEqual([K.lsa]);
  });

  test("pela biblioteca: de que componente ela sai", async () => {
    const res = await q.libraryUsage(K.platform);
    expect(res.producedBy!.map((e) => e.node.key)).toEqual([FRAMEWORK]);
    expect(res.packages).toBeUndefined();
    expect(res.users.every((u) => !("library" in u))).toBe(true);
  });

  test("componente que não gera biblioteca: ninguém usa", async () => {
    const res = await q.libraryUsage(K.pca);
    expect(res.packages).toEqual([]);
    expect(res.users).toEqual([]);
  });
});

test("o escopo guarda quem montou o retrato", async () => {
  const status = await q.sourcesStatus({ source: "build-manifest" });
  const scope = status.sources[0].scopes.find((s) => s.scope.component === "example/platform/framework")!;
  expect(scope.producer).toEqual({ name: "graph-publish", version: "0.2.0" });
  // Retrato sem produtor (o da fixture) não ganha um.
  const sbom = await q.sourcesStatus({ source: "sbom" });
  expect(sbom.sources[0].scopes.every((s) => s.producer === undefined)).toBe(true);
});
