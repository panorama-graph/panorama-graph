import { z } from "zod";

/**
 * Código estável do erro, para o cliente decidir sem ler a mensagem. Os específicos (ambiguous, outdated_snapshot,
 * ...) valem mais que o genérico do status; um código novo é mudança compatível, renomear ou remover não é.
 */
export const ERROR_CODES = [
  "invalid_request", // 400: forma do pedido (corpo, parâmetros, JSON)
  "unauthorized", // 401: sem sessão ou token, ou token inválido
  "forbidden", // 403
  "not_found", // 404: nó, rota ou escopo que não existe
  "unknown_tool", // 404: ferramenta fora do contrato das consultas
  "method_not_allowed", // 405
  "conflict", // 409
  "ambiguous", // 409: o nome casa com mais de um nó (details.candidates)
  "outdated_snapshot", // 409: retrato mais antigo que o último do escopo
  "payload_too_large", // 413
  "unsupported_media_type", // 415
  "unprocessable", // 422: pedido bem formado que o domínio recusa
  "invalid_snapshot", // 422: carga fora do modelo ou sem evidência (details.errors)
  "internal", // 500
  "unavailable", // 503
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const BY_STATUS: Record<number, ErrorCode> = {
  400: "invalid_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable",
  503: "unavailable",
};

export const codeForStatus = (status: number): ErrorCode => BY_STATUS[status] ?? (status >= 500 ? "internal" : "invalid_request");

/** Erro de domínio com status HTTP. O tratador de erros do app e o MCP o devolvem no formato de ErrorBody. */
export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: Record<string, unknown>,
    code?: ErrorCode,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code ?? codeForStatus(statusCode);
  }
}

/**
 * O formato único dos erros, no REST e no MCP: `error` (mensagem para gente), `code` (para o cliente decidir),
 * `status` (o HTTP, que o MCP não tem) e `details` (o que o código acrescenta: candidates, errors, validation).
 */
export const errorBodySchema = z
  .object({
    error: z.string().describe("Mensagem legível"),
    code: z.enum(ERROR_CODES).describe("Código estável do erro: o cliente decide por ele, não pela mensagem"),
    status: z.number().int().describe("Status HTTP"),
    details: z.record(z.unknown()).optional().describe("Dados do erro, conforme o código"),
  })
  .describe("Erro");

export type ErrorBody = { error: string; code: ErrorCode; status: number; details?: Record<string, unknown> };

export function errorBody(status: number, message: string, code?: ErrorCode, details?: Record<string, unknown>): ErrorBody {
  return {
    error: message,
    code: code ?? codeForStatus(status),
    status,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  };
}

export const apiErrorBody = (err: ApiError) => errorBody(err.statusCode, err.message, err.code, err.details);
