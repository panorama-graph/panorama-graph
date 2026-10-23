import { PanoramaGraphClient, PanoramaGraphError, type AuthSession, type QueryName } from "@panorama-graph/sdk";

/**
 * Cliente das consultas do grafo: `POST /v1/queries/<ferramenta>`, as mesmas que os agentes chamam pelo MCP, com os
 * mesmos argumentos e a mesma resposta. O console não tem consulta própria: o que ele mostra, um agente também vê.
 */
export const GRAPH_API_URL = ((import.meta.env.VITE_GRAPH_API_URL as string | undefined) || "http://localhost:3200").replace(/\/+$/, "");

// O cookie da sessão (SSO) vai junto: a API fica em outra origem.
const client = new PanoramaGraphClient({ baseUrl: GRAPH_API_URL, credentials: "include" });

/** Erro da consulta (formato único do grafo: error, code, status, details), com os candidatos no 409 de nome ambíguo. */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly candidates?: { key: string; name?: string }[],
  ) {
    super(message);
  }
}

/**
 * Uma consulta. Os argumentos vêm montados pela tela (com `detail` e `includeStale` só para quem os aceita), por isso
 * entram sem o tipo de cada ferramenta; a resposta é a que a tela declara.
 */
export async function runQuery<T>(tool: QueryName, args: Record<string, unknown>): Promise<T> {
  try {
    return (await client.query(tool, args as never)) as T;
  } catch (e) {
    if (!(e instanceof PanoramaGraphError)) throw e;
    if (e.code === "unreachable") throw new GraphError(`Não foi possível falar com o grafo em ${GRAPH_API_URL}.`, 0);
    const candidates = Array.isArray(e.details?.candidates) ? (e.details.candidates as { key: string; name?: string }[]) : undefined;
    throw new GraphError(e.message, e.status, candidates);
  }
}

/** O modo de autenticação da instância e quem está na sessão. */
export async function fetchSession(): Promise<AuthSession> {
  try {
    return await client.me();
  } catch (e) {
    if (e instanceof PanoramaGraphError && e.code === "unreachable") throw new GraphError(`Não foi possível falar com o grafo em ${GRAPH_API_URL}.`, 0);
    throw e;
  }
}

/** Entrar pelo SSO e voltar para `returnTo`. */
export const loginUrl = (returnTo: string) => client.loginUrl(returnTo);

/** Sair da sessão e do provedor, e voltar para `returnTo`. */
export const logoutUrl = (returnTo: string) => client.logoutUrl(returnTo);
