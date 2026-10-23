import { z } from "zod";
import "dotenv/config";

const list = z
  .string()
  .default("")
  .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean));
const optional = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === "" ? undefined : v), t.optional());

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().positive().default(3200),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
    NEO4J_URI: z.string().min(1),
    NEO4J_USER: z.string().min(1).default("neo4j"),
    NEO4J_PASSWORD: z.string().min(1),
    NEO4J_DATABASE: z.string().min(1).default("neo4j"),
    /** Origens liberadas para as consultas REST no navegador, separadas por vírgula. */
    CORS_ORIGINS: list,
    /** Dias que o retrato congelado de um commit fica depois de sair de todos os ambientes. */
    FROZEN_RETENTION_DAYS: z.coerce.number().positive().default(30),
    /** Dias que uma implantação que saiu do ambiente fica como histórico (fora de produção). */
    DEPLOY_HISTORY_DAYS: z.coerce.number().positive().default(30),
    /** O mesmo, em ambiente de produção. */
    DEPLOY_HISTORY_DAYS_PRODUCTION: z.coerce.number().positive().default(365),
    /** Intervalo da limpeza da retenção, em minutos (0 desliga). */
    RETENTION_INTERVAL_MINUTES: z.coerce.number().min(0).default(60),

    // Autenticação. Sem OIDC_ISSUER, a instância roda no modo anônimo (sem login).
    /** Emissor OIDC do provedor da organização: liga o login por SSO. */
    OIDC_ISSUER: optional(z.string().url()),
    /** Onde a API lê a descoberta, quando ela não alcança o emissor pelo endereço público (ex.: o Keycloak do compose). */
    OIDC_DISCOVERY_URL: optional(z.string().url()),
    /** Aceita provedor sem HTTPS fora de localhost (só para laboratório). */
    OIDC_ALLOW_HTTP: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    OIDC_CLIENT_ID: optional(z.string().min(1)),
    /** Sem segredo, o cliente é público e se protege só pelo PKCE. */
    OIDC_CLIENT_SECRET: optional(z.string().min(1)),
    OIDC_SCOPES: z.string().min(1).default("openid profile email"),
    /** Claim com os grupos da pessoa, no ID token e nos tokens de serviço. */
    OIDC_GROUPS_CLAIM: z.string().min(1).default("groups"),
    /** Endereço da API visto pelo navegador (padrão http://localhost:<API_PORT>): base do retorno do provedor. */
    API_PUBLIC_URL: optional(z.string().url()),
    /** Segredo que assina o cookie da sessão (32+ caracteres). Igual em todas as réplicas. */
    SESSION_SECRET: optional(z.string().min(32)),
    SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
    /** none quando o console e a API ficam em sites diferentes (exige HTTPS). */
    SESSION_COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
    /** Emissores de JWT aceitos em Authorization: Bearer (o provedor, o OIDC do CI), separados por vírgula. */
    JWT_ISSUERS: list,
    /** Audiência exigida nesses JWTs. */
    JWT_AUDIENCE: z.string().min(1).default("panorama-graph"),
    /** Token fixo dos adaptadores (16+ caracteres). No modo anônimo, a escrita passa a exigi-lo. */
    INGEST_TOKEN: optional(z.string().min(16)),
  })
  .superRefine((e, ctx) => {
    if (!e.OIDC_ISSUER) return;
    if (!e.OIDC_CLIENT_ID) ctx.addIssue({ code: "custom", path: ["OIDC_CLIENT_ID"], message: "obrigatório com OIDC_ISSUER" });
    if (!e.SESSION_SECRET) ctx.addIssue({ code: "custom", path: ["SESSION_SECRET"], message: "obrigatório com OIDC_ISSUER" });
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[fatal] Variáveis de ambiente inválidas:", JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
