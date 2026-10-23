import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { JwtConfig } from "./config";
import { groupsFrom, type Identity } from "./identity";

/**
 * Tokens de serviço: JWT de um emissor confiável (o provedor da organização, por client credentials, ou o OIDC do
 * CI), com a audiência configurada. As chaves vêm do `jwks_uri` que o emissor publica na descoberta OIDC.
 */
export class JwtVerifier {
  private readonly keys = new Map<string, Promise<JWTVerifyGetKey>>();

  constructor(private readonly config: JwtConfig) {}

  /** A identidade do token, ou null se ele não for um JWT de um emissor confiável e válido. */
  async verify(token: string): Promise<Identity | null> {
    let iss: string | undefined;
    try {
      iss = decodeJwt(token).iss;
    } catch {
      return null;
    }
    if (!iss || !this.config.issuers.includes(iss)) return null;
    try {
      const { payload } = await jwtVerify(token, await this.keySet(iss), { issuer: iss, audience: this.config.audience });
      if (!payload.sub) return null;
      return {
        kind: "service",
        subject: payload.sub,
        issuer: iss,
        name: typeof payload.name === "string" ? payload.name : payload.sub,
        groups: groupsFrom(payload, this.config.groupsClaim),
      };
    } catch {
      return null;
    }
  }

  private keySet(issuer: string): Promise<JWTVerifyGetKey> {
    let keys = this.keys.get(issuer);
    if (!keys) {
      keys = fetch(this.config.discovery?.[issuer] ?? `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`descoberta de ${issuer} respondeu ${res.status}`);
          const { jwks_uri } = (await res.json()) as { jwks_uri?: string };
          if (!jwks_uri) throw new Error(`${issuer} não publica jwks_uri`);
          return createRemoteJWKSet(new URL(jwks_uri));
        })
        .catch((err) => {
          this.keys.delete(issuer); // tenta de novo no próximo token
          throw err;
        });
      this.keys.set(issuer, keys);
    }
    return keys;
  }
}
