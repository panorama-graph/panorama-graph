import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { Auth } from "../auth/guard";
import type { AuthSession } from "../auth/identity";
import { ApiError } from "../errors";

type ReturnQuery = { returnTo?: string };

/**
 * Autenticação. `GET /auth/me` diz o modo da instância e quem está na sessão (o console decide por ele se mostra o
 * login). Login, volta do provedor e logout são navegação do navegador, não chamadas de API: respondem com
 * redirecionamento e ficam fora do OpenAPI.
 */
export function authRoutes(auth: Auth, logger: Logger) {
  return async (app: FastifyInstance) => {
    app.get(
      "/auth/me",
      { config: { access: "public", cors: true }, schema: { tags: ["autenticação"], summary: "Modo de autenticação e quem está na sessão" } },
      async (req): Promise<AuthSession> => ({ mode: auth.mode, identity: req.identity }),
    );

    app.get("/auth/login", { config: { access: "public" }, schema: { hide: true } }, async (req, reply) => {
      const login = requireSso(auth);
      const started = await login.start(auth.returnTo((req.query as ReturnQuery).returnTo)).catch((err) => {
        logger.error({ reqId: req.id, err }, "auth.login.discovery.error");
        throw new ApiError(503, "O provedor de SSO não respondeu. Tente de novo em instantes.");
      });
      auth.saveLogin(reply, started.tx);
      return reply.redirect(started.url);
    });

    app.get("/auth/callback", { config: { access: "public" }, schema: { hide: true } }, async (req, reply) => {
      const login = requireSso(auth);
      const tx = auth.takeLogin(req, reply);
      const back = tx?.returnTo ?? auth.returnTo(undefined);
      if (!tx) return reply.redirect(withLoginError(back, "O login venceu ou começou em outro navegador. Entre de novo."));
      const query = req.url.slice(req.url.indexOf("?") + 1);
      try {
        const identity = await login.finish(query, tx);
        auth.startSession(reply, identity);
        logger.info({ reqId: req.id, subject: identity.subject, issuer: identity.issuer }, "auth.login");
        return reply.redirect(back);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        logger.warn({ reqId: req.id, err }, "auth.login.error");
        return reply.redirect(withLoginError(back, "O provedor recusou o login ou a resposta dele não confere."));
      }
    });

    app.get("/auth/logout", { config: { access: "public" }, schema: { hide: true } }, async (req, reply) => {
      const login = requireSso(auth);
      const back = auth.returnTo((req.query as ReturnQuery).returnTo);
      auth.endSession(reply);
      return reply.redirect(await login.logoutUrl(back));
    });
  };
}

function requireSso(auth: Auth) {
  if (!auth.login) throw new ApiError(404, "Esta instância não tem SSO configurado (OIDC_ISSUER)");
  return auth.login;
}

function withLoginError(url: string, message: string): string {
  const u = new URL(url);
  u.searchParams.set("loginError", message);
  return u.href;
}
