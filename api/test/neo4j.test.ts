import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDb, resetDatabase } from "./setup";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.close());

describe("GraphDb", () => {
  test("grava e lê de volta", async () => {
    await db.write("CREATE (:Probe {key: $key, n: $n})", { key: "probe:1", n: 42 });
    const { records } = await db.read<{ n: number }>("MATCH (p:Probe {key: $key}) RETURN p.n AS n", { key: "probe:1" });
    expect(records).toHaveLength(1);
    expect(Number(records[0].get("n"))).toBe(42);
  });

  test("começa cada teste com o banco vazio", async () => {
    const { records } = await db.read("MATCH (n) RETURN count(n) AS total");
    expect(Number(records[0].get("total"))).toBe(0);
  });

  test("informa versão 5 e edição community", async () => {
    const info = await db.serverInfo();
    expect(info.version.startsWith("5.")).toBe(true);
    expect(info.edition).toBe("community");
  });
});
