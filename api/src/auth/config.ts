import type { Env } from "../config/env";

/** Login pelo provedor da organização (OIDC). Sem ele, a instância roda no modo anônimo. */
export type SsoConfig = {
  /** Emissor OIDC (ex.: https://login.microsoftonline.com/<tenant>/v2.0, https://sso.example.com/realms/x). */
  issuer: string;
  /** Descoberta lida de outro endereço que não o do emissor (o emissor das respostas continua conferido). */
  discoveryUrl?: string;
  /** Provedor sem HTTPS; sempre aceito em localhost. */
  allowHttp: boolean;
  clientId: string;
  /** Sem segredo, o cliente é público e se protege só pelo PKCE. */
  clientSecret?: string;
  scopes: string;
  /** Claim com os grupos da pessoa (cada provedor usa uma). */
  groupsClaim: string;
  /** Endereço da API visto pelo navegador: base do `redirect_uri` e do cookie `Secure`. */
  publicUrl: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  sameSite: "lax" | "strict" | "none";
};

/**
 * Tokens de serviço (`Authorization: Bearer <JWT>`), validados pelas chaves públicas de cada emissor confiável.
 * `discovery` troca o endereço da descoberta de um emissor (o do SSO, quando há `OIDC_DISCOVERY_URL`).
 */
export type JwtConfig = { issuers: string[]; audience: string; groupsClaim: string; discovery?: Record<string, string> };

export type AuthConfig = {
  sso?: SsoConfig;
  jwt?: JwtConfig;
  /** Token fixo para os adaptadores. No modo anônimo, a escrita passa a exigi-lo. */
  ingestToken?: string;
};

export function authConfigFromEnv(env: Env): AuthConfig {
  return {
    ...(env.OIDC_ISSUER
      ? {
          sso: {
            issuer: env.OIDC_ISSUER,
            discoveryUrl: env.OIDC_DISCOVERY_URL,
            allowHttp: env.OIDC_ALLOW_HTTP,
            clientId: env.OIDC_CLIENT_ID!,
            clientSecret: env.OIDC_CLIENT_SECRET,
            scopes: env.OIDC_SCOPES,
            groupsClaim: env.OIDC_GROUPS_CLAIM,
            publicUrl: env.API_PUBLIC_URL ?? `http://localhost:${env.API_PORT}`,
            sessionSecret: env.SESSION_SECRET!,
            sessionTtlSeconds: env.SESSION_TTL_HOURS * 3600,
            sameSite: env.SESSION_COOKIE_SAMESITE,
          },
        }
      : {}),
    ...(env.JWT_ISSUERS.length > 0
      ? {
          jwt: {
            issuers: env.JWT_ISSUERS,
            audience: env.JWT_AUDIENCE,
            groupsClaim: env.OIDC_GROUPS_CLAIM,
            ...(env.OIDC_ISSUER && env.OIDC_DISCOVERY_URL ? { discovery: { [env.OIDC_ISSUER]: env.OIDC_DISCOVERY_URL } } : {}),
          },
        }
      : {}),
    ...(env.INGEST_TOKEN ? { ingestToken: env.INGEST_TOKEN } : {}),
  };
}

/** HTTP sem TLS só para um emissor na própria máquina (localhost ou *.localhost), como o Keycloak de exemplo. */
export function isLocalHttp(url: string): boolean {
  const u = new URL(url);
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.endsWith(".localhost"));
}
