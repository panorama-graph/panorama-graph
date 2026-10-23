import { MODEL_VERSION } from "./generated/model.js";
import {
  API_PREFIX,
  type AliasResult,
  type AuthSession,
  type ErrorBody,
  type IngestResult,
  type MergeRequest,
  type MergeResult,
  type ModelDescription,
  type QueryArgs,
  type QueryContractDocument,
  type QueryName,
  type QueryResults,
  type RetireResult,
  type ScopeRetirement,
  type Snapshot,
} from "./generated/types.js";

/** Código do erro: os da API (`ErrorBody.code`) e `unreachable`, quando a API não respondeu. */
export type ErrorCode = ErrorBody["code"] | "unreachable";

/**
 * Erro devolvido pela API, no formato único `{ error, code, status, details }`. Decida pelo `code`, que é estável
 * (ex.: `not_found`, `ambiguous`, `outdated_snapshot`), e não pela mensagem.
 */
export class PanoramaGraphError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PanoramaGraphError";
  }
}

/** O que o cliente usa do fetch: a global serve, e os testes passam uma de mentira. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ClientOptions = {
  /** Endereço da API, sem o `/v1` (ex.: `http://localhost:3200`). */
  baseUrl: string;
  /** Implementação de fetch (padrão: a global). */
  fetch?: FetchLike;
  /** Cabeçalhos enviados em toda requisição. */
  headers?: Record<string, string>;
  /** Token de ingestão ou JWT de um emissor confiável, enviado como `Authorization: Bearer`. */
  token?: string;
  /** No navegador, `include` manda o cookie da sessão do SSO para a API em outra origem. */
  credentials?: RequestCredentials;
};

/** Argumentos de uma consulta: opcionais quando nenhum é obrigatório. */
type ArgsOf<N extends QueryName> = object extends QueryArgs[N] ? [args?: QueryArgs[N]] : [args: QueryArgs[N]];

/** Cliente do REST do panorama-graph (`/v1`): consultas, modelo, carga e identidade dos nós. */
export class PanoramaGraphClient {
  private readonly base: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: ClientOptions) {
    this.base = options.baseUrl.replace(/\/+$/, "") + API_PREFIX;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  /** Uma consulta, com os mesmos argumentos e a mesma resposta da ferramenta MCP de mesmo nome. */
  query<N extends QueryName>(name: N, ...[args]: ArgsOf<N>): Promise<QueryResults[N]> {
    return this.request("POST", `/queries/${encodeURIComponent(name)}`, args ?? {});
  }

  /** O contrato das consultas que a API serve: versão, política e ferramentas. */
  queryContract(): Promise<QueryContractDocument> {
    return this.request("GET", "/queries");
  }

  /** O modelo: tipos de nó e de relação, pares válidos, chaves e proveniência. */
  schema(): Promise<ModelDescription> {
    return this.request("GET", "/schema");
  }

  /**
   * Confere se a API está no modelo deste SDK (`MODEL_VERSION`). Um produtor chama antes de mandar retratos: com
   * modelos diferentes, a carga pode ser recusada ou perder o que o outro lado não conhece.
   */
  async assertModel(): Promise<void> {
    const { modelVersion } = await this.schema();
    if (modelVersion !== MODEL_VERSION) {
      throw new PanoramaGraphError(
        `A API está no modelo ${modelVersion}, e este SDK no modelo ${MODEL_VERSION}. Atualize um dos dois.`,
        "conflict",
        409,
        { apiModelVersion: modelVersion, sdkModelVersion: MODEL_VERSION },
      );
    }
  }

  /**
   * Carga por retrato: o que a fonte viu no escopo. O que a mesma fonte e escopo deixaram de afirmar vira stale.
   * Retrato mais antigo que o último do escopo é recusado com o código `outdated_snapshot`. Com `dryRun`, a API
   * confere o retrato e devolve as contagens de uma carga de verdade, sem gravar nada.
   */
  ingest(snapshot: Snapshot, options: { dryRun?: boolean } = {}): Promise<IngestResult> {
    return this.request("POST", options.dryRun ? "/ingest?dryRun=true" : "/ingest", snapshot);
  }

  /** Aposenta um escopo em todas as fontes. Nenhuma fonte ter carregado nele é `not_found`. */
  retireScope(req: ScopeRetirement): Promise<RetireResult> {
    return this.request("POST", "/scopes/retire", req);
  }

  /** O modo de autenticação da instância (`anonymous` ou `sso`) e quem está na sessão. */
  me(): Promise<AuthSession> {
    return this.request("GET", "/auth/me");
  }

  /** Onde o navegador vai para entrar pelo SSO; depois do login, volta para `returnTo`. */
  loginUrl(returnTo: string): string {
    return `${this.base}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  }

  /** Onde o navegador vai para sair (da sessão e do provedor); depois, volta para `returnTo`. */
  logoutUrl(returnTo: string): string {
    return `${this.base}/auth/logout?returnTo=${encodeURIComponent(returnTo)}`;
  }

  /** Registra um apelido para o nó. */
  addAlias(key: string, alias: string, reason?: string): Promise<AliasResult> {
    return this.request("POST", `/nodes/${encodeURIComponent(key)}/aliases`, { alias, ...(reason ? { reason } : {}) });
  }

  /** Une dois nós do mesmo tipo: `from` vira apelido de `into`. */
  merge(req: MergeRequest): Promise<MergeResult> {
    return this.request("POST", "/nodes/merge", req);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = this.base + path;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          ...this.options.headers,
          ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        ...(this.options.credentials ? { credentials: this.options.credentials } : {}),
      });
    } catch (e) {
      throw new PanoramaGraphError(`Sem resposta de ${url}: ${(e as Error).message}`, "unreachable", 0);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (res.ok) return json as T;
    const err = json as Partial<ErrorBody> | undefined;
    throw new PanoramaGraphError(
      err?.error ?? `${method} ${path} respondeu ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
      err?.code ?? (res.status >= 500 ? "internal" : "invalid_request"),
      res.status,
      err?.details,
    );
  }
}
