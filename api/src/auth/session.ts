import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valores assinados para cookies: `<payload em base64url>.<HMAC-SHA256>`, com a validade (`exp`, em segundos) dentro
 * do payload. Sem estado no servidor: a sessão sobrevive a reinícios e vale em qualquer réplica com o mesmo segredo.
 */
export class Signer {
  constructor(private readonly secret: string) {}

  sign(payload: object, ttlSeconds: number): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
    return `${body}.${this.mac(body)}`;
  }

  /** O payload, ou null se a assinatura não confere, o valor está malformado ou venceu. */
  verify<T>(value: string | undefined): T | null {
    if (!value) return null;
    const dot = value.indexOf(".");
    if (dot < 0) return null;
    const body = value.slice(0, dot);
    const mac = Buffer.from(value.slice(dot + 1));
    const expected = Buffer.from(this.mac(body));
    if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
      if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private mac(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }
}

export type CookieOptions = { maxAge: number; sameSite: "lax" | "strict" | "none"; secure: boolean; path?: string };

export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${value}`, `Path=${o.path ?? "/"}`, `Max-Age=${o.maxAge}`, "HttpOnly", `SameSite=${o.sameSite[0].toUpperCase()}${o.sameSite.slice(1)}`];
  if (o.secure) parts.push("Secure");
  return parts.join("; ");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}
