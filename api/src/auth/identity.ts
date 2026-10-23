import { z } from "zod";

/**
 * Quem faz a requisição. Toda requisição tem uma, real ou não: sem SSO, é a anônima; com SSO, a pessoa que entrou
 * pelo provedor (sessão) ou o serviço que mandou um token (`Authorization: Bearer`). O resto da API não sabe como
 * a identidade chegou.
 */
export const identitySchema = z
  .object({
    kind: z.enum(["anonymous", "person", "service"]).describe("anonymous: instância sem SSO; person: login pelo provedor; service: token"),
    subject: z.string().describe("Identificador estável no emissor (o `sub` do provedor)"),
    issuer: z.string().optional().describe("Emissor da identidade (o `iss` do provedor ou do token)"),
    name: z.string().describe("Nome para mostrar"),
    email: z.string().optional(),
    groups: z.array(z.string()).describe("Grupos que o provedor afirma (claim configurável)"),
  })
  .describe("Quem faz a requisição");

export type Identity = z.infer<typeof identitySchema>;

export const authSessionSchema = z
  .object({
    mode: z.enum(["anonymous", "sso"]).describe("anonymous: instância sem autenticação; sso: login pelo provedor da organização"),
    identity: identitySchema.nullable().describe("Quem está na sessão; null no modo sso sem login"),
  })
  .describe("O modo de autenticação da instância e quem está na sessão");

export type AuthSession = z.infer<typeof authSessionSchema>;

export const ANONYMOUS: Identity = { kind: "anonymous", subject: "anonymous", name: "Anônimo", groups: [] };

export const INGEST_TOKEN_IDENTITY: Identity = { kind: "service", subject: "ingest-token", name: "Token de ingestão", groups: [] };

/** Os grupos de um conjunto de claims: lista de textos, texto único ou nada. */
export function groupsFrom(claims: Record<string, unknown>, claim: string): string[] {
  const v = claims[claim];
  if (Array.isArray(v)) return v.filter((g): g is string => typeof g === "string");
  return typeof v === "string" ? [v] : [];
}
