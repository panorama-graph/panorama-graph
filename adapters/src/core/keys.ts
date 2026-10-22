/**
 * Receitas de chave: as do SDK, as mesmas em todos os produtores. Aqui ficam só os auxiliares de leitura das fontes
 * (purl, caminhos de rota).
 */
import { normalizePath } from "@panorama-graph/sdk";

export {
  componentKey,
  contractKey,
  datasetKey,
  domainKey,
  endpointKey,
  environmentKey,
  groupKey,
  httpApiKey,
  libraryKey,
  nodeTypeFromKey,
  normalizePath,
  personKey,
  repositoryKey,
  resourceKey,
  systemKey,
  technologyKey,
  topicKey,
  topicVersion,
  normalizeInterfaceVersion,
  pathVersion,
  splitServiceVersion,
} from "@panorama-graph/sdk";

/** Coordenadas de um purl (`pkg:maven/org.x/y@1.0?type=jar`), sem versão nem qualificadores. */
export function parsePurl(purl: string): { type: string; namespace?: string; name: string; version?: string } | undefined {
  const m = /^pkg:([^/]+)\/([^@?#]+)(?:@([^?#]+))?/.exec(purl);
  if (!m) return undefined;
  const parts = m[2].split("/").map(decodeURIComponent);
  const name = parts.pop()!;
  return {
    type: m[1],
    ...(parts.length ? { namespace: parts.join("/") } : {}),
    name,
    ...(m[3] ? { version: decodeURIComponent(m[3]) } : {}),
  };
}

/** Junta caminhos de base e de operação (`/products` + `/{id}`), mantendo os nomes dos parâmetros. */
export function joinPaths(...parts: (string | undefined)[]): string {
  const p = ("/" + parts.filter(Boolean).join("/")).replace(/\/+/g, "/");
  return p.length > 1 ? p.replace(/\/$/, "") : p;
}

/** Um caminho concreto (`/products/p-1`) casa com um modelo (`/products/{}`)? */
export function matchesTemplate(concrete: string, template: string): boolean {
  const c = normalizePath(concrete.split("?")[0]).split("/");
  const t = normalizePath(template).split("/");
  return c.length === t.length && t.every((seg, i) => seg === "{}" || seg === c[i]);
}
