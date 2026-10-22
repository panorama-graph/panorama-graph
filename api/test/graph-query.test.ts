import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApiError } from "../src/errors";
import { runReadOnly } from "../src/query/graphQuery";
import { createTestDb, resetDatabase } from "./setup";

const db = createTestDb();

beforeAll(async () => {
  await resetDatabase(db);
  await db.write(
    `UNWIND range(1, 30) AS i
     CREATE (:Node:Component {key: 'component:c' + i, type: 'Component', name: 'c' + i})`,
  );
  await db.write(
    `MATCH (a:Node {key: 'component:c1'}), (b:Node {key: 'component:c2'})
     CREATE (a)-[:CONSUMES {source: 'test', status: 'current', observedAt: '2026-09-29T10:00:00Z'}]->(b)`,
  );
});
afterAll(() => db.close());

async function refused(cypher: string, params: Record<string, unknown> = {}): Promise<string> {
  try {
    await runReadOnly(db, cypher, params);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(422);
    return (err as ApiError).message;
  }
  throw new Error(`esperava recusa: ${cypher}`);
}

const count = async () => (await db.read("MATCH (n) RETURN count(n) AS n")).records[0].get("n") as number;

describe("graph_query só de leitura", () => {
  test("recusa escrita, esquema, LOAD CSV e PROFILE", async () => {
    const before = await count();
    expect(await refused("CREATE (n:Node {key: 'x'})")).toContain("só aceita leitura");
    expect(await refused("MERGE (n:Node {key: 'component:c1'}) RETURN n")).toContain("só aceita leitura");
    expect(await refused("MATCH (n:Node {key: 'component:c1'}) SET n.name = 'hack'")).toContain("só aceita leitura");
    expect(await refused("MATCH (n) DETACH DELETE n")).toContain("só aceita leitura");
    expect(await refused("CREATE INDEX x IF NOT EXISTS FOR (n:Node) ON (n.name)")).toContain("só aceita leitura");
    expect(await refused("MATCH (n) WITH n LIMIT 1 CALL { WITH n SET n.x = 1 } RETURN n")).toContain("só aceita leitura");
    expect(await refused("LOAD CSV FROM 'file:///etc/passwd' AS l RETURN l")).toContain("LOAD CSV");
    expect(await refused("PROFILE MATCH (n) RETURN n")).toContain("EXPLAIN");
    expect(await refused("MATCH (n RETURN n")).toContain("Cypher recusado");
    expect(await count()).toBe(before);
    const names = await db.read("MATCH (n:Node {key: 'component:c1'}) RETURN n.name AS name");
    expect(names.records[0].get("name")).toBe("c1");
  });

  test("devolve colunas e linhas, com parâmetros", async () => {
    const res = await runReadOnly(db, "MATCH (n:Component) WHERE n.name = $name RETURN n.key AS key, n.name AS name", {
      name: "c3",
    });
    expect(res).toEqual({ columns: ["key", "name"], rows: [{ key: "component:c3", name: "c3" }], truncated: false });
  });

  test("corta no limite e avisa", async () => {
    const res = await runReadOnly(db, "MATCH (n:Component) RETURN n.key AS key ORDER BY key", {}, { limit: 10 });
    expect(res.rows).toHaveLength(10);
    expect(res.truncated).toBe(true);
    const all = await runReadOnly(db, "MATCH (n:Component) RETURN n.key AS key");
    expect(all.rows).toHaveLength(30);
    expect(all.truncated).toBe(false);
  });

  test("corta pelo tamanho e diz o que fazer", async () => {
    const res = await runReadOnly(db, "MATCH (n:Component) RETURN n.key AS key ORDER BY key", {}, { maxChars: 100 });
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.length).toBeLessThan(30);
    expect(res).toMatchObject({ truncated: true, truncatedBy: "size" });
    expect(res.note).toContain("Library");
  });

  test("resultado vazio ainda traz as colunas", async () => {
    const res = await runReadOnly(db, "MATCH (n:Component {name: 'nenhum'}) RETURN n.key AS key");
    expect(res).toEqual({ columns: ["key"], rows: [], truncated: false });
  });

  test("serializa nó, relação e caminho", async () => {
    const res = await runReadOnly(
      db,
      "MATCH p = (a:Node {key: 'component:c1'})-[r:CONSUMES]->(b) RETURN a, r, p",
    );
    const row = res.rows[0] as Record<string, any>;
    expect(row.a).toEqual({ labels: expect.arrayContaining(["Node", "Component"]), properties: { key: "component:c1", type: "Component", name: "c1" } });
    expect(row.r).toMatchObject({ type: "CONSUMES", properties: { source: "test", status: "current" } });
    expect(row.p.start.properties.key).toBe("component:c1");
    expect(row.p.segments[0]).toMatchObject({ relationship: { type: "CONSUMES" }, end: { properties: { key: "component:c2" } } });
  });

  test("passa do tempo limite", async () => {
    const msg = (async () => {
      try {
        await runReadOnly(
          db,
          "UNWIND range(1, 100000000) AS x WITH x WHERE x % 7 = 0 RETURN count(x) AS n",
          {},
          { timeoutMs: 100 },
        );
      } catch (err) {
        return (err as Error).message;
      }
      return "sem erro";
    })();
    expect(await msg).toContain("limite de 100 ms");
  }, 20_000);
});
