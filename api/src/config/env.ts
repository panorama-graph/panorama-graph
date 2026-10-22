import { z } from "zod";
import "dotenv/config";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3200),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  NEO4J_URI: z.string().min(1),
  NEO4J_USER: z.string().min(1).default("neo4j"),
  NEO4J_PASSWORD: z.string().min(1),
  NEO4J_DATABASE: z.string().min(1).default("neo4j"),
  /** Origens liberadas para as consultas REST no navegador, separadas por vírgula. */
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean)),
  /** Dias que o retrato congelado de um commit fica depois de sair de todos os ambientes. */
  FROZEN_RETENTION_DAYS: z.coerce.number().positive().default(30),
  /** Dias que uma implantação que saiu do ambiente fica como histórico (fora de produção). */
  DEPLOY_HISTORY_DAYS: z.coerce.number().positive().default(30),
  /** O mesmo, em ambiente de produção. */
  DEPLOY_HISTORY_DAYS_PRODUCTION: z.coerce.number().positive().default(365),
  /** Intervalo da limpeza da retenção, em minutos (0 desliga). */
  RETENTION_INTERVAL_MINUTES: z.coerce.number().min(0).default(60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[fatal] Variáveis de ambiente inválidas:", JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
