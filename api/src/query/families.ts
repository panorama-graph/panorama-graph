import type { ManagedTransaction } from "neo4j-driver";
import { liveNode, visParams, type Vis } from "./view";

/** Uma versão de uma interface: a chave do nó e a versão (`v1`), ausente na interface sem versão. */
export type InterfaceVersion = { key: string; version?: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Família de uma interface versionada: as versões da mesma API ou do mesmo tópico, que são nós diferentes
 * Sai da convenção das chaves, igual em todos os produtores, e não de uma relação:
 * - API: `api:<serviço>[/v<N>]/<tipo>` (a versão do código e a exposta na infraestrutura caem no mesmo serviço);
 * - tópico: `topic:<nome>[-.]v<N>`, com o nome sem a versão como família.
 * Fora dessas formas, a interface é a única da família.
 */
export function familyOf(key: string): { prefix: string; pattern: RegExp } | null {
  const api = /^api:(.+?)(?:\/v\d+)?\/([^/]+)$/i.exec(key);
  if (api) {
    const [, service, kind] = api;
    return { prefix: `api:${service}/`, pattern: new RegExp(`^api:${escape(service)}(?:/v\\d+)?/${escape(kind)}$`, "i") };
  }
  if (key.startsWith("topic:")) return topicFamily(key.slice("topic:".length));
  return null;
}

/** Família de tópicos pelo nome, com ou sem a versão no fim (`product-created` ou `product-created.v2`). */
export function topicFamily(name: string): { prefix: string; pattern: RegExp } {
  const base = name.replace(/[-.]v\d+$/i, "");
  return { prefix: `topic:${base}`, pattern: new RegExp(`^topic:${escape(base)}(?:[-.]v\\d+)?$`, "i") };
}

/** Sem versão primeiro, depois v1, v2...: a mais nova é a última. */
export function byVersion(a: InterfaceVersion, b: InterfaceVersion): number {
  const n = (v?: string) => (v ? Number(/\d+/.exec(v)?.[0] ?? 0) : -1);
  return n(a.version) - n(b.version) || a.key.localeCompare(b.key);
}

/** As versões vivas da família, no retrato da consulta. `key` entra sempre, mesmo fora do retrato. */
export async function familyMembers(
  tx: ManagedTransaction,
  family: { prefix: string; pattern: RegExp },
  vis: Vis,
  key?: string,
): Promise<InterfaceVersion[]> {
  const res = await tx.run(
    `MATCH (n:Node) WHERE n.type IN ['Api', 'Topic'] AND n.key STARTS WITH $prefix AND (${liveNode("n", vis)} OR n.key = $key)
     RETURN n.key AS key, n.version AS version`,
    { prefix: family.prefix, key: key ?? null, ...visParams(vis) },
  );
  return res.records
    .map((r) => ({ key: r.get("key") as string, version: (r.get("version") as string | null) ?? undefined }))
    .filter((m) => family.pattern.test(m.key))
    .map((m) => (m.version ? m : { key: m.key }))
    .sort(byVersion);
}
