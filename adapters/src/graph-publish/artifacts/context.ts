import { componentKey, normalizeInterfaceVersion } from "../../core/keys";
import { SnapshotBuilder } from "../../core/snapshot";
import type { Identity } from "../identity";

/** O que todo tradutor precisa saber: quem publica, onde apontar a evidência e como abrir um retrato. */
export type Context = {
  id: Identity;
  component: string;
  /** Caminho, relativo à raiz do repositório, do diretório de artefatos (ex.: `build/architecture`). */
  artifactsDir: string;
  /** `kind` do Component (service, bff, frontend, job, library). */
  kind: string;
  /** Retrato congelado do commit (escopo com `commit`), e não o da linha principal. */
  frozen: boolean;
};

export function createContext(id: Identity, opts: { artifactsDir?: string; kind?: string; frozen?: boolean } = {}): Context {
  const artifactsDir = (opts.artifactsDir ?? "build/architecture").replace(/\/$/, "");
  return { id, component: componentKey(id.path), artifactsDir, kind: opts.kind ?? "service", frozen: !!opts.frozen };
}

/**
 * Um retrato por fonte, com escopo = o componente (e o commit, no retrato congelado) e evidência `repo@sha:`. A
 * evidência de cada fato é o caminho do artefato (ou do código), relativo à raiz do repositório.
 */
export function builder(ctx: Context, source: string): SnapshotBuilder {
  const scope: Record<string, string> = ctx.frozen ? { component: ctx.id.path, commit: ctx.id.commit } : { component: ctx.id.path };
  return new SnapshotBuilder(source, scope, `${ctx.id.path}@${ctx.id.commit}:`);
}

/** Evidência dentro de um artefato, com ponteiro JSON opcional (`build/architecture/openapi.json#/paths/...`). */
export function artifactEvidence(ctx: Context, file: string, pointer?: string[]): string {
  const base = `${ctx.artifactsDir}/${file}`;
  return pointer?.length ? `${base}#/${pointer.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}` : base;
}

/**
 * Extensão de OpenAPI e AsyncAPI com o ponto do código que declara a operação, o canal ou a API, relativo à raiz do
 * repositório e na convenção dos outros formatos (`src/.../ProductController.java#L42` ou `#getProduct`). Quem gera
 * o documento sem o build (à mão, ou um gerador de outra stack) a informa para a evidência apontar para o código, e
 * não para um artefato que o repositório não tem.
 */
export const SOURCE_EXTENSION = "x-panorama-graph-source";

/**
 * A evidência que a extensão informa em `holder`, ou `fallback` sem ela. Um valor que não é um caminho relativo
 * dentro do repositório (absoluto, com `..`, URL) é ignorado com aviso.
 */
export function sourceEvidence(b: SnapshotBuilder, source: string, holder: unknown, fallback: string, where: string): string {
  if (!holder || typeof holder !== "object" || !(SOURCE_EXTENSION in holder)) return fallback;
  const value = (holder as Record<string, unknown>)[SOURCE_EXTENSION];
  if (typeof value === "string" && isRepoPath(value)) return value;
  const warning = `${source}: ${SOURCE_EXTENSION} inválido em ${where} (${JSON.stringify(value)}); a evidência fica no artefato`;
  if (!b.warnings.includes(warning)) b.warn(warning);
  return fallback;
}

function isRepoPath(value: string): boolean {
  const path = value.split("#")[0];
  if (!path || /\s/.test(path) || path.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return false;
  return !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

/**
 * Extensão de OpenAPI e AsyncAPI com a versão da interface (`v2`), para quem a conhece por um padrão que a convenção
 * não lê (cabeçalho, media type, nome do tipo da mensagem). No OpenAPI, vale em `info` (a API inteira), no path item
 * ou na operação; no AsyncAPI, no canal. Declarada, ela vence a da convenção.
 */
export const VERSION_EXTENSION = "x-panorama-graph-version";

/** A versão declarada em `holder` (`2`, `v2` e `V2` são `v2`). Um valor fora de `v<N>` é ignorado com aviso. */
export function declaredVersion(b: SnapshotBuilder, source: string, holder: unknown, where: string): string | undefined {
  if (!holder || typeof holder !== "object" || !(VERSION_EXTENSION in holder)) return undefined;
  const value = (holder as Record<string, unknown>)[VERSION_EXTENSION];
  const version = typeof value === "string" || typeof value === "number" ? normalizeInterfaceVersion(String(value)) : undefined;
  if (version) return version;
  const warning = `${source}: ${VERSION_EXTENSION} inválido em ${where} (${JSON.stringify(value)}); vale a versão da convenção`;
  if (!b.warnings.includes(warning)) b.warn(warning);
  return undefined;
}
