import { NODE_TYPES, type NodeType } from "./model";

/**
 * Formato das chaves: `<prefixo>:<identificador>`. O prefixo determina o tipo do nó
 * (`component:example/catalog/product-api` é um Component). O identificador é livre,
 * sem espaço nas bordas nem caracteres de controle (o de Endpoint tem espaço no meio:
 * `endpoint:product-api/GET /products/{id}`).
 */
export const KEY_FORMAT = "<prefixo>:<identificador>";

const TYPE_BY_PREFIX = new Map<string, NodeType>(
  Object.entries(NODE_TYPES).map(([type, spec]) => [spec.prefix, type as NodeType]),
);

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type KeyCheck = { ok: true; type: NodeType } | { ok: false; error: string };

export function checkKey(key: string): KeyCheck {
  const i = key.indexOf(":");
  if (i <= 0) return { ok: false, error: `chave "${key}" fora do formato ${KEY_FORMAT}` };
  const prefix = key.slice(0, i);
  const id = key.slice(i + 1);
  const type = TYPE_BY_PREFIX.get(prefix);
  if (!type) {
    return { ok: false, error: `chave "${key}": prefixo "${prefix}" desconhecido (aceitos: ${[...TYPE_BY_PREFIX.keys()].join(", ")})` };
  }
  if (id.length === 0 || id.trim() !== id || CONTROL_CHARS.test(id)) {
    return { ok: false, error: `chave "${key}": identificador vazio, com espaço nas bordas ou caractere de controle` };
  }
  return { ok: true, type };
}

export function typeFromKey(key: string): NodeType | undefined {
  const c = checkKey(key);
  return c.ok ? c.type : undefined;
}
