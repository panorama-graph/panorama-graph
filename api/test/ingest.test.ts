import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

const db = createTestDb();
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger });
});
beforeEach(() => resetDatabase(db));
afterAll(async () => {
  await app.close();
  await db.close();
});

type Counts = { created: number; updated: number; unchanged: number; stale: number };
type Result = { loadId: string; counts: { nodes: Counts; relations: Counts; referenced: number } };

let clock = 0;
const nextTime = () => new Date(Date.UTC(2026, 8, 29, 10, 0, clock++)).toISOString();

async function ingest(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/ingest", payload: { observedAt: nextTime(), ...body } });
}

const gitlab = (extra: { nodes?: object[]; relations?: { type: string; from: string; to: string }[] } = {}) => ({
  source: "gitlab",
  scope: { group: "acme/credito" },
  evidenceBase: "https://gitlab.acme/",
  nodes: [
    { key: "domain:credito", type: "Domain", props: { name: "Crédito" }, evidence: "acme/credito" },
    { key: "system:credito/simulacao", type: "System", evidence: "acme/credito" },
    { key: "component:acme/credito/product-catalog-api", type: "Component", props: { kind: "service" }, evidence: "acme/credito/product-catalog-api" },
    { key: "repo:gitlab/acme/credito/product-catalog-api", type: "Repository", evidence: "acme/credito/product-catalog-api" },
    ...(extra.nodes ?? []),
  ],
  relations: [
    { type: "PART_OF", from: "system:credito/simulacao", to: "domain:credito" },
    { type: "PART_OF", from: "component:acme/credito/product-catalog-api", to: "system:credito/simulacao" },
    { type: "HOSTED_IN", from: "component:acme/credito/product-catalog-api", to: "repo:gitlab/acme/credito/product-catalog-api" },
    ...(extra.relations ?? []),
  ],
});

async function relations(type: string) {
  const { records } = await db.read(
    `MATCH (a:Node)-[r:${type}]->(b:Node) RETURN a.key AS from, b.key AS to, properties(r) AS r ORDER BY r.source`,
  );
  return records.map((x) => ({ from: x.get("from"), to: x.get("to"), ...x.get("r") }));
}

describe("POST /ingest", () => {
  test("grava nós, afirmações e relações com proveniência", async () => {
    const res = await ingest(gitlab());
    expect(res.statusCode).toBe(200);
    const body = res.json<Result>();
    expect(body.counts.nodes).toEqual({ created: 4, updated: 0, unchanged: 0, stale: 0 });
    expect(body.counts.relations).toEqual({ created: 3, updated: 0, unchanged: 0, stale: 0 });

    const [hosted] = await relations("HOSTED_IN");
    expect(hosted).toMatchObject({
      source: "gitlab",
      state: "observed",
      status: "current",
      evidence: "https://gitlab.acme/", // sem evidência própria: fica a evidenceBase
      loadId: body.loadId,
    });
    expect(hosted.id).toBeTypeOf("string");

    const { records } = await db.read(
      `MATCH (c:Claim)-[:CLAIMS]->(n:Component) RETURN n.kind AS kind, n.type AS type, c.source AS source, c.evidence AS evidence`,
    );
    expect(records[0].toObject()).toEqual({
      kind: "service",
      type: "Component",
      source: "gitlab",
      evidence: "https://gitlab.acme/acme/credito/product-catalog-api",
    });

    const load = await db.read(`MATCH (l:Load {id: $id}) RETURN l.source AS source`, { id: body.loadId });
    expect(load.records[0].get("source")).toBe("gitlab");
  });

  test("400 para forma inválida, 422 para fora do modelo", async () => {
    expect((await ingest({ source: "Git Lab", nodes: [] })).statusCode).toBe(400);
    expect((await ingest({ ...gitlab(), state: "confirmed" })).statusCode).toBe(400);

    const res = await ingest({
      source: "gitlab",
      nodes: [{ key: "component:x", type: "Component" }],
      relations: [{ type: "CONSUMES", from: "component:x", to: "component:y", evidence: "e" }],
    });
    expect(res.statusCode).toBe(422);
    const { code, details } = res.json<{ code: string; details: { errors: string[] } }>();
    expect(code).toBe("invalid_snapshot");
    expect(details.errors).toHaveLength(2);
    expect(await relations("CONSUMES")).toHaveLength(0);
  });

  test("recarga igual não muda nada; o que some vira stale e continua consultável; a volta atualiza", async () => {
    await ingest(gitlab());
    const again = (await ingest(gitlab())).json<Result>();
    expect(again.counts.nodes).toEqual({ created: 0, updated: 0, unchanged: 4, stale: 0 });
    expect(again.counts.relations).toEqual({ created: 0, updated: 0, unchanged: 3, stale: 0 });

    const partial = gitlab();
    partial.relations = partial.relations.filter((r) => r.type !== "HOSTED_IN");
    const gone = (await ingest(partial)).json<Result>();
    expect(gone.counts.relations).toEqual({ created: 0, updated: 0, unchanged: 2, stale: 1 });
    const [stale] = await relations("HOSTED_IN");
    expect(stale.status).toBe("stale");
    expect(stale.loadId).toBe(again.loadId);

    const back = (await ingest(gitlab())).json<Result>();
    expect(back.counts.relations).toEqual({ created: 0, updated: 1, unchanged: 2, stale: 0 });
    const [current] = await relations("HOSTED_IN");
    expect(current.status).toBe("current");
    expect(current.id).toBe(stale.id);
    expect(current.firstObservedAt < current.observedAt).toBe(true);
  });

  test("mudança de evidência ou de propriedade conta como atualizada", async () => {
    await ingest({ source: "sbom", evidenceBase: "sbom:", relations: [{ type: "DEPENDS_ON", from: "component:a", to: "lib:maven/x:y", props: { version: "1.0" } }] });
    const res = (
      await ingest({ source: "sbom", evidenceBase: "sbom:", relations: [{ type: "DEPENDS_ON", from: "component:a", to: "lib:maven/x:y", props: { version: "1.1" } }] })
    ).json<Result>();
    expect(res.counts.relations.updated).toBe(1);
    const [dep] = await relations("DEPENDS_ON");
    expect(dep.version).toBe("1.1");
  });

  test("duas fontes na mesma relação geram duas afirmações paralelas", async () => {
    const consumes = [{ type: "CONSUMES", from: "component:loan-simulation-api", to: "api:product-catalog-api/http" }];
    await ingest({ source: "pact-broker", scope: { participant: "loan-simulation-api" }, evidenceBase: "pact:", relations: consumes });
    await ingest({ source: "service-config", scope: { component: "loan-simulation-api" }, evidenceBase: "helm:", relations: consumes });

    const rels = await relations("CONSUMES");
    expect(rels.map((r) => r.source)).toEqual(["pact-broker", "service-config"]);

    // Uma fonte deixar de afirmar não derruba a afirmação da outra.
    await ingest({ source: "pact-broker", scope: { participant: "loan-simulation-api" }, evidenceBase: "pact:", relations: [] });
    const after = await relations("CONSUMES");
    expect(after.map((r) => [r.source, r.status])).toEqual([
      ["pact-broker", "stale"],
      ["service-config", "current"],
    ]);
  });

  test("escopos diferentes da mesma fonte não se afetam", async () => {
    const pact = (participant: string, relations: unknown[]) =>
      ingest({ source: "pact-broker", scope: { participant }, evidenceBase: "pact:", relations });
    await pact("a", [{ type: "CONSUMES", from: "component:a", to: "api:x/http" }]);
    await pact("b", [{ type: "CONSUMES", from: "component:b", to: "api:x/http" }]);
    await pact("b", []);
    const rels = await relations("CONSUMES");
    expect(rels.map((r) => [r.from, r.status]).sort()).toEqual([
      ["component:a", "current"],
      ["component:b", "stale"],
    ]);
  });

  test("retrato mais antigo que o último do escopo é recusado", async () => {
    const body = gitlab();
    expect((await app.inject({ method: "POST", url: "/v1/ingest", payload: { ...body, observedAt: "2026-09-29T12:00:00Z" } })).statusCode).toBe(200);
    const old = await app.inject({ method: "POST", url: "/v1/ingest", payload: { ...body, observedAt: "2026-09-29T11:00:00Z" } });
    expect(old.statusCode).toBe(409);
    // Outro escopo não é afetado.
    const other = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      payload: { ...body, scope: { group: "acme/outro" }, observedAt: "2026-09-29T11:00:00Z" },
    });
    expect(other.statusCode).toBe(200);
  });

  test("ponta desconhecida vira nó referenciado, depois afirmado por outra fonte", async () => {
    const pact = (
      await ingest({
        source: "pact-broker",
        evidenceBase: "pact:",
        relations: [{ type: "CONSUMES", from: "component:loan-simulation-api", to: "api:product-catalog-api/http" }],
      })
    ).json<Result>();
    expect(pact.counts.referenced).toBe(2);

    const ref = await db.read(
      `MATCH (n:Node:Api {key: 'api:product-catalog-api/http'}) RETURN n.type AS type, count { (n)<-[:CLAIMS]-() } AS claims`,
    );
    expect(ref.records[0].toObject()).toEqual({ type: "Api", claims: 0 });

    const openapi = (
      await ingest({
        source: "openapi",
        evidenceBase: "openapi:",
        nodes: [{ key: "api:product-catalog-api/http", type: "Api", props: { kind: "http" } }],
      })
    ).json<Result>();
    expect(openapi.counts.nodes.created).toBe(1);
    expect(openapi.counts.referenced).toBe(0);

    const claimed = await db.read(
      `MATCH (n:Node {key: 'api:product-catalog-api/http'}) RETURN n.kind AS kind, count { (n)<-[:CLAIMS]-() } AS claims, count { (n)<-[:CONSUMES]-() } AS consumers`,
    );
    expect(claimed.records[0].toObject()).toEqual({ kind: "http", claims: 1, consumers: 1 });
  });

  test("ROUTES com host ou path diferentes coexistem", async () => {
    const route = (path: string) => ({
      type: "ROUTES",
      from: "resource:dev/ingress-nginx",
      to: "component:product-catalog-api",
      props: { host: "product-catalog-api.dev.acmebank.example", path },
    });
    const res = (await ingest({ source: "k8s-routes", evidenceBase: "ingress:", relations: [route("/"), route("/admin")] })).json<Result>();
    expect(res.counts.relations.created).toBe(2);
    const again = (await ingest({ source: "k8s-routes", evidenceBase: "ingress:", relations: [route("/")] })).json<Result>();
    expect(again.counts.relations).toEqual({ created: 0, updated: 0, unchanged: 1, stale: 1 });
  });
});

describe("POST /scopes/retire", () => {
  const scope = { component: "acme/sandbox/x-api" };
  const other = { component: "acme/credito/y-api" };
  const manifest = (s: Record<string, string>, name: string) => ({
    source: "build-manifest",
    scope: s,
    evidenceBase: `${s.component}@abc:`,
    nodes: [
      { key: `component:${s.component}`, type: "Component", props: { kind: "service", name }, evidence: "manifest.json" },
      { key: `repo:gitlab/${s.component}`, type: "Repository", evidence: "manifest.json" },
    ],
    relations: [{ type: "HOSTED_IN", from: `component:${s.component}`, to: `repo:gitlab/${s.component}` }],
  });
  const sbom = (s: Record<string, string>) => ({
    source: "sbom",
    scope: s,
    evidenceBase: `${s.component}@abc:bom.json`,
    relations: [{ type: "DEPENDS_ON", from: `component:${s.component}`, to: "lib:maven/x:y", props: { version: "1.0" } }],
  });
  const retire = (over: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/v1/scopes/retire",
      payload: {
        scope,
        observedAt: nextTime(),
        retiredBy: "idp",
        reason: "componente removido",
        evidence: "http://idp/operations/1",
        ...over,
      },
    });
  const status = async (key: string) =>
    (await db.read(`MATCH (n:Node {key: $key}) RETURN n.status AS s`, { key })).records[0]?.get("s");

  test("todas as fontes do escopo viram stale; o que outro escopo afirma continua", async () => {
    await ingest(manifest(scope, "x-api"));
    await ingest(sbom(scope));
    await ingest(manifest(other, "y-api"));
    await ingest(sbom(other));

    const res = await retire();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      scope,
      sources: [
        { source: "build-manifest", counts: { nodes: { stale: 2 }, relations: { stale: 1 } } },
        { source: "sbom", counts: { nodes: { stale: 0 }, relations: { stale: 1 } } },
      ],
    });

    expect(await status("component:acme/sandbox/x-api")).toBe("stale");
    expect(await status("repo:gitlab/acme/sandbox/x-api")).toBe("stale");
    // A biblioteca continua: outro componente ainda depende dela.
    expect(await status("lib:maven/x:y")).toBe("current");
    expect(await status("component:acme/credito/y-api")).toBe("current");
    const deps = (await relations("DEPENDS_ON")).map((r) => [r.from, r.status]);
    expect(deps).toContainEqual(["component:acme/sandbox/x-api", "stale"]);
    expect(deps).toContainEqual(["component:acme/credito/y-api", "current"]);

    const loads = await db.read(
      `MATCH (l:Load {scopeKey: $scopeKey}) WHERE l.retiredBy IS NOT NULL RETURN l.source AS source, l.reason AS reason, l.evidence AS evidence ORDER BY source`,
      { scopeKey: JSON.stringify(scope) },
    );
    expect(loads.records.map((r) => r.toObject())).toEqual([
      { source: "build-manifest", reason: "componente removido", evidence: "http://idp/operations/1" },
      { source: "sbom", reason: "componente removido", evidence: "http://idp/operations/1" },
    ]);
  });

  test("uma carga depois da aposentadoria volta a valer", async () => {
    await ingest(manifest(scope, "x-api"));
    await retire();
    await ingest(manifest(scope, "x-api"));
    expect(await status("component:acme/sandbox/x-api")).toBe("current");
  });

  test("escopo sem carga é 404; aposentadoria mais antiga que a última carga é 409; corpo inválido é 400", async () => {
    expect((await retire()).statusCode).toBe(404);
    const before = nextTime();
    await ingest(manifest(scope, "x-api"));
    expect((await retire({ observedAt: before })).statusCode).toBe(409);
    expect(await status("component:acme/sandbox/x-api")).toBe("current");
    expect((await retire({ scope: {} })).statusCode).toBe(400);
    expect((await retire({ reason: undefined })).statusCode).toBe(400);
  });
});

describe("cargas simultâneas", () => {
  test("fontes diferentes criando os mesmos nós ao mesmo tempo: todas gravam, e cada nó existe uma vez", async () => {
    // Cada fonte declara os próprios componentes e aponta para os mesmos grupos, que ninguém declarou: as transações
    // criam o mesmo nó referenciado ao mesmo tempo. Sem a nova tentativa, a que perde a corrida recebe a violação da
    // chave única (500).
    const groups = Array.from({ length: 30 }, (_, i) => `group:time-${i}`);
    const load = (source: string) => ({
      source,
      scope: { tenant: "acme" },
      evidenceBase: "https://exemplo/",
      nodes: [{ key: `component:acme/${source}`, type: "Component", evidence: source }],
      relations: groups.map((g) => ({ type: "OWNED_BY", from: `component:acme/${source}`, to: g, evidence: source })),
    });
    const sources = Array.from({ length: 8 }, (_, i) => `fonte-${i}`);
    for (let round = 0; round < 3; round++) {
      await resetDatabase(db);
      const res = await Promise.all(sources.map((s) => ingest(load(s))));
      expect(res.map((r) => r.statusCode)).toEqual(sources.map(() => 200));
    }
    const count = await db.read("MATCH (n:Node) WHERE n.key STARTS WITH 'group:time-' RETURN count(n) AS n");
    expect(count.records[0].get("n")).toBe(groups.length);
  });
});
