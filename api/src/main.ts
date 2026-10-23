import { env } from "./config/env";
import { createLogger } from "./config/logger";
import { GraphDb } from "./db/neo4j";
import { ensureConstraints } from "./db/constraints";
import { buildApp } from "./app";
import { authConfigFromEnv } from "./auth/config";
import { RetentionService } from "./ingest/RetentionService";

const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV !== "production", env: env.NODE_ENV });

async function bootstrap() {
  const db = new GraphDb({
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
    database: env.NEO4J_DATABASE,
  });

  // Sobe mesmo sem o Neo4j: /health/ready mostra o problema em vez de o processo morrer.
  // As restrições são criadas aqui ou, se o banco estiver fora, na primeira escrita.
  try {
    await db.verifyConnectivity();
    logger.info({ uri: env.NEO4J_URI, database: env.NEO4J_DATABASE }, "neo4j conectado");
    await ensureConstraints(db);
    logger.info("restrições e índices do grafo garantidos");
  } catch (err) {
    logger.warn({ err, uri: env.NEO4J_URI }, "neo4j indisponível na subida");
  }

  const auth = authConfigFromEnv(env);
  if (auth.sso) logger.info({ issuer: auth.sso.issuer, clientId: auth.sso.clientId }, "login por SSO (OIDC)");
  else {
    logger.warn(
      { ingestToken: Boolean(auth.ingestToken) },
      auth.ingestToken
        ? "sem SSO: leitura aberta a quem alcança a API (identidade anônima); a escrita exige o INGEST_TOKEN"
        : "sem SSO e sem INGEST_TOKEN: leitura e escrita abertas a quem alcança a API (identidade anônima)",
    );
  }
  const app = await buildApp({ db, logger, docs: env.NODE_ENV !== "production", corsOrigins: env.CORS_ORIGINS, auth });

  // Retenção: retratos congelados que saíram dos ambientes e histórico de deploys antigo.
  const retention = new RetentionService(db, {
    frozenDays: env.FROZEN_RETENTION_DAYS,
    deployHistoryDays: env.DEPLOY_HISTORY_DAYS,
    deployHistoryProductionDays: env.DEPLOY_HISTORY_DAYS_PRODUCTION,
  });
  const prune = async () => {
    try {
      const r = await retention.prune();
      if (r.deployments + r.frozenScopes.length + r.nodes > 0) logger.info(r, "retenção aplicada");
    } catch (err) {
      logger.warn({ err }, "retenção falhou; tenta de novo no próximo intervalo");
    }
  };
  const timer = env.RETENTION_INTERVAL_MINUTES > 0 ? setInterval(prune, env.RETENTION_INTERVAL_MINUTES * 60_000) : null;

  const stop = async (signal: string) => {
    logger.warn({ signal }, "desligando servidor");
    if (timer) clearInterval(timer);
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));

  await app.listen({ host: "0.0.0.0", port: env.API_PORT });
  logger.info({ port: env.API_PORT }, "panorama-graph-api no ar");
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "falha na subida");
  process.exit(1);
});
