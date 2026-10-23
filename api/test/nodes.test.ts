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

let clock = 0;
const nextTime = () => new Date(Date.UTC(2026, 8, 29, 10, 0, clock++)).toISOString();
const ingest = (body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/ingest", payload: { observedAt: nextTime(), ...body } });
const alias = (key: string, alias: string) =>
  app.inject({ method: "POST", url: `/v1/nodes/${encodeURIComponent(key)}/aliases`, payload: { alias, reason: "nome antigo" } });
const merge = (from: string, into: string) =>
  app.inject({ method: "POST", url: "/v1/nodes/merge", payload: { from, into, reason: "mesmo serviço", actor: "claude" } });

const PCA = "component:acme/credito/product-catalog-api";
const OLD = "component:product-catalog";

async function seedGitlab() {
  await ingest({
    source: "gitlab",
    evidenceBase: "gitlab:",
    nodes: [{ key: PCA, type: "Component", props: { name: "product-catalog-api", kind: "service" } }],
    relations: [{ type: "HOSTED_IN", from: PCA, to: "repo:gitlab/acme/credito/product-catalog-api" }],
  });
}

const pactLoad = () =>
  ingest({
    source: "pact-broker",
    scope: { participant: "loan-simulation-api" },
    evidenceBase: "pact:",
    relations: [{ type: "PROVIDES", from: OLD, to: "api:product-catalog-api/http" }],
  });

async function node(key: string) {
  const { records } = await db.read(
    `MATCH (n:Node {key: $key})
     RETURN n.key AS key, properties(n) AS props,
            [(a:Alias)-[:ALIAS_OF]->(n) | a.key] AS aliases,
            [(n)-[r]->(x:Node) | type(r) + '>' + x.key + '@' + r.source] AS out`,
    { key },
  );
  return records[0]?.toObject();
}

describe("apelidos", () => {
  test("apelido faz a carga cair no nó canônico", async () => {
    await seedGitlab();
    const res = await alias(PCA, OLD);
    expect(res.statusCode).toBe(201);
    expect((await alias(PCA, OLD)).statusCode).toBe(200);

    expect((await pactLoad()).statusCode).toBe(200);
    expect(await node(OLD)).toBeUndefined();
    expect((await node(PCA))!.out).toContain("PROVIDES>api:product-catalog-api/http@pact-broker");
  });

  test("resolve o nó pelo próprio apelido", async () => {
    await seedGitlab();
    await alias(PCA, OLD);
    const res = await alias(OLD, "component:pca");
    expect(res.statusCode).toBe(201);
    expect(res.json<{ key: string }>().key).toBe(PCA);
  });

  test("colisões e erros", async () => {
    await seedGitlab();
    await pactLoad(); // cria OLD como nó referenciado
    expect((await alias(PCA, OLD)).statusCode).toBe(409); // já é nó: pede merge
    expect((await alias(PCA, "repo:x")).statusCode).toBe(422); // tipo diferente
    expect((await alias(PCA, "sem-prefixo")).statusCode).toBe(422);
    expect((await alias("component:nao-existe", "component:y")).statusCode).toBe(404);
    expect((await alias(PCA, PCA)).statusCode).toBe(409);

    await alias(PCA, "component:pca");
    expect((await alias(OLD, "component:pca")).statusCode).toBe(409); // apelido de outro nó
  });
});

describe("união", () => {
  test("move relações e afirmações, vira apelido e é auditada", async () => {
    await seedGitlab();
    await pactLoad();
    await ingest({
      source: "service-config",
      evidenceBase: "helm:",
      relations: [{ type: "CONSUMES", from: "component:loan-simulation-api", to: "api:product-catalog-api/http" }],
      nodes: [{ key: OLD, type: "Component", props: { description: "Catálogo de produtos" } }],
    });

    const res = await merge(OLD, PCA);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ relations: { moved: number }; claims: { moved: number }; aliases: string[] }>();
    expect(body.relations.moved).toBe(1);
    expect(body.claims.moved).toBe(1);
    expect(body.aliases).toEqual([OLD]);

    expect(await node(OLD)).toBeUndefined();
    const n = (await node(PCA))!;
    expect(n.aliases).toEqual([OLD]);
    expect(n.props).toMatchObject({ name: "product-catalog-api", description: "Catálogo de produtos" });
    expect(n.out).toContain("PROVIDES>api:product-catalog-api/http@pact-broker");

    const audit = await db.read(`MATCH (m:Merge)-[:MERGED_INTO]->(:Node {key: $key}) RETURN m.from AS from, m.actor AS actor`, { key: PCA });
    expect(audit.records[0].toObject()).toEqual({ from: OLD, actor: "claude" });

    // A próxima carga com o nome antigo mantém a mesma afirmação.
    const again = (await pactLoad()).json<{ counts: { relations: { unchanged: number; created: number } } }>();
    expect(again.counts.relations).toMatchObject({ unchanged: 1, created: 0 });
  });

  test("afirmação repetida depois da união fica só a mais recente", async () => {
    const rel = (from: string) => ({ type: "PROVIDES", from, to: "api:product-catalog-api/http" });
    await ingest({ source: "openapi", scope: { c: "1" }, evidenceBase: "old:", relations: [rel(OLD)] });
    await ingest({ source: "openapi", scope: { c: "1" }, evidenceBase: "new:", relations: [rel(PCA)] });
    // A segunda carga deixou a primeira stale; a união junta as duas afirmações da mesma fonte e escopo.
    const res = await merge(OLD, PCA);
    expect(res.json<{ relations: { deduplicated: number } }>().relations.deduplicated).toBe(1);
    const { records } = await db.read(`MATCH (:Node {key: $key})-[r:PROVIDES]->() RETURN r.evidence AS e, r.status AS s`, { key: PCA });
    expect(records.map((r) => r.toObject())).toEqual([{ e: "new:", s: "current" }]);
  });

  test("recusa tipos diferentes, o mesmo nó e nó inexistente", async () => {
    await seedGitlab();
    await alias(PCA, OLD);
    expect((await merge(PCA, "repo:gitlab/acme/credito/product-catalog-api")).statusCode).toBe(422);
    expect((await merge(OLD, PCA)).statusCode).toBe(422);
    expect((await merge("component:nao-existe", PCA)).statusCode).toBe(404);
  });
});
