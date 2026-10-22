import { NODE_STATUS_CYPHER } from "../graph/nodeStatus";
import { RELATION_TYPE_NAMES } from "../model/model";
import type { GraphDb } from "./neo4j";

/**
 * Restrições e índices do grafo. Idempotente (IF NOT EXISTS).
 * Os tipos de relação vêm da lista fechada do modelo, por isso entram direto no Cypher.
 */
export function constraintStatements(): string[] {
  const stmts = [
    "CREATE CONSTRAINT node_key IF NOT EXISTS FOR (n:Node) REQUIRE n.key IS UNIQUE",
    "CREATE CONSTRAINT alias_key IF NOT EXISTS FOR (a:Alias) REQUIRE a.key IS UNIQUE",
    "CREATE CONSTRAINT claim_id IF NOT EXISTS FOR (c:Claim) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT load_id IF NOT EXISTS FOR (l:Load) REQUIRE l.id IS UNIQUE",
    "CREATE CONSTRAINT scope_id IF NOT EXISTS FOR (s:Scope) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT merge_id IF NOT EXISTS FOR (m:Merge) REQUIRE m.id IS UNIQUE",
    "CREATE INDEX claim_scope IF NOT EXISTS FOR (c:Claim) ON (c.source, c.scopeKey)",
    "CREATE INDEX node_status IF NOT EXISTS FOR (n:Node) ON (n.status)",
  ];
  for (const t of RELATION_TYPE_NAMES) {
    const name = t.toLowerCase();
    stmts.push(`CREATE INDEX rel_${name}_id IF NOT EXISTS FOR ()-[r:${t}]-() ON (r.id)`);
    stmts.push(`CREATE INDEX rel_${name}_scope IF NOT EXISTS FOR ()-[r:${t}]-() ON (r.source, r.scopeKey)`);
  }
  return stmts;
}

const ready = new WeakMap<GraphDb, Promise<void>>();

/** Cria as restrições (e completa a vigência de nós antigos) uma vez por processo. Se falhar (Neo4j fora), tenta de novo na próxima chamada. */
export function ensureConstraints(db: GraphDb): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      for (const stmt of constraintStatements()) await db.write(stmt);
      await db.write("CALL db.awaitIndexes(30)");
      // Nós gravados antes da vigência derivada: calcula uma vez.
      await db.write(`MATCH (n:Node) WHERE n.status IS NULL ${NODE_STATUS_CYPHER}`);
      // Group.kind saiu na v12 (o nível vem de AT_LEVEL): a carga nova não a regrava, então sai dos grupos antigos.
      await db.write("MATCH (g:Group) WHERE g.kind IS NOT NULL REMOVE g.kind");
    })();
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}
