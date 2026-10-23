import * as oidc from "openid-client";
import type { SsoConfig } from "./config";
import { isLocalHttp } from "./config";
import { groupsFrom, type Identity } from "./identity";

/** O que o login guarda entre a ida ao provedor e a volta: confere a resposta e diz para onde voltar. */
export type LoginTransaction = { state: string; nonce: string; verifier: string; returnTo: string };

export const CALLBACK_PATH = "/v1/auth/callback";

/**
 * Login pelo provedor OIDC: authorization code com PKCE, conduzido pela API. O provedor é descoberto pelo
 * `.well-known/openid-configuration` do emissor na primeira vez que alguém entra, e não na subida: a API sobe
 * mesmo com o provedor fora do ar.
 */
export class OidcLogin {
  private config?: Promise<oidc.Configuration>;
  readonly redirectUri: string;

  constructor(private readonly sso: SsoConfig) {
    this.redirectUri = new URL(CALLBACK_PATH, sso.publicUrl).href;
  }

  async start(returnTo: string): Promise<{ url: string; tx: LoginTransaction }> {
    const config = await this.configuration();
    const tx: LoginTransaction = { state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier(), returnTo };
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.redirectUri,
      scope: this.sso.scopes,
      code_challenge: await oidc.calculatePKCECodeChallenge(tx.verifier),
      code_challenge_method: "S256",
      state: tx.state,
      nonce: tx.nonce,
    });
    return { url: url.href, tx };
  }

  /** Troca o código pelos tokens, confere state, nonce e a assinatura do ID token, e devolve a pessoa. */
  async finish(query: string, tx: LoginTransaction): Promise<Identity> {
    const config = await this.configuration();
    const current = new URL(this.redirectUri);
    current.search = query;
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: tx.verifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims()! as oidc.IDToken & Record<string, unknown>;
    const text = (k: string) => (typeof claims[k] === "string" ? (claims[k] as string) : undefined);
    const email = text("email");
    return {
      kind: "person",
      subject: claims.sub,
      issuer: claims.iss,
      name: text("name") ?? text("preferred_username") ?? email ?? claims.sub,
      ...(email ? { email } : {}),
      groups: groupsFrom(claims, this.sso.groupsClaim),
    };
  }

  /** O logout no provedor, quando ele o oferece; sem ele, volta direto para `returnTo`. */
  async logoutUrl(returnTo: string): Promise<string> {
    const config = await this.configuration().catch(() => undefined);
    if (!config?.serverMetadata().end_session_endpoint) return returnTo;
    return oidc.buildEndSessionUrl(config, { client_id: this.sso.clientId, post_logout_redirect_uri: returnTo }).href;
  }

  private configuration(): Promise<oidc.Configuration> {
    // Com a URL da descoberta (`/.well-known/`), o openid-client não exige que ela fique no endereço do emissor.
    this.config ??= oidc
      .discovery(
        new URL(this.sso.discoveryUrl ?? this.sso.issuer),
        this.sso.clientId,
        this.sso.clientSecret,
        this.sso.clientSecret ? undefined : oidc.None(),
        this.sso.allowHttp || isLocalHttp(this.sso.issuer) ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((err) => {
        this.config = undefined; // tenta de novo no próximo login
        throw err;
      });
    return this.config;
  }
}
