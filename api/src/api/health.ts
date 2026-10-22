import type { FastifyInstance } from "fastify";
import type { GraphDb } from "../db/neo4j";

export function healthRoutes(db: GraphDb) {
  return async (app: FastifyInstance) => {
    // Liveness: o processo responde. Não toca no banco.
    app.get("/health", async () => ({ status: "ok" }));

    // Readiness: o Neo4j responde a uma consulta no database configurado.
    app.get("/health/ready", async (_req, reply) => {
      try {
        await db.ping();
        const server = await db.serverInfo();
        return { status: "ok", neo4j: { ...server, database: db.database } };
      } catch (err) {
        return reply.code(503).send({
          status: "unavailable",
          neo4j: { database: db.database, error: err instanceof Error ? err.message : String(err) },
        });
      }
    });
  };
}
