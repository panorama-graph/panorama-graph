import "dotenv/config";
import pino from "pino";
import { GraphDb } from "../src/db/neo4j";
import { ensureConstraints } from "../src/db/constraints";

// Os testes apagam o banco inteiro. Só rodam contra o Neo4j de teste (serviço `neo4j-test`).
const uri = process.env.NEO4J_TEST_URI ?? "bolt://localhost:7688";
const password = process.env.NEO4J_TEST_PASSWORD ?? "testpassword";

if (process.env.NEO4J_URI && new URL(uri).port === new URL(process.env.NEO4J_URI).port) {
  throw new Error(`NEO4J_TEST_URI (${uri}) aponta para a mesma porta do banco de desenvolvimento. Recusando.`);
}

export function createTestDb(overrides: Partial<{ uri: string }> = {}): GraphDb {
  return new GraphDb({ uri: overrides.uri ?? uri, user: "neo4j", password, database: "neo4j" });
}

export async function resetDatabase(db: GraphDb): Promise<void> {
  await db.write("MATCH (n) DETACH DELETE n");
}

export const silentLogger = pino({ level: "silent" });

try {
  const probe = createTestDb();
  await probe.verifyConnectivity();
  await ensureConstraints(probe);
  await probe.close();
} catch (err) {
  throw new Error(
    `Neo4j de teste indisponível em ${uri}. Suba com \`pnpm run test:db:up\`. (${err instanceof Error ? err.message : err})`,
  );
}
