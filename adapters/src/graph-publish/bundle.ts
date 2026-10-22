import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Os artefatos de arquitetura de um build, lidos de onde estiverem: o diretório `build/architecture` (graph-publish,
 * graph-deployments) ou os arquivos que o build enviou ao graph-receiver. Todos são JSON.
 */
export type BuildFiles = {
  /** O conteúdo de um arquivo (`manifest.json`, `pacts/web.json`), ou `undefined` se ele não veio. */
  read(path: string): unknown;
  /** Os nomes dos arquivos de uma pasta (`pacts`), ou `undefined` se ela não veio. */
  list(dir: string): string[] | undefined;
};

/** Caminho de arquivo aceito num pacote: relativo, sem `..`, terminado em `.json`. */
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/;

export function isBundlePath(path: string): boolean {
  return SAFE_PATH.test(path);
}

export function dirFiles(dir: string): BuildFiles {
  return {
    read(path) {
      const file = join(dir, path);
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    },
    list(sub) {
      const path = join(dir, sub);
      return existsSync(path) && statSync(path).isDirectory() ? readdirSync(path) : undefined;
    },
  };
}

/** Arquivos já lidos, por caminho relativo (`{ "manifest.json": {...}, "pacts/web.json": {...} }`). */
export function mapFiles(files: Record<string, unknown>): BuildFiles {
  return {
    read: (path) => files[path],
    list(dir) {
      const prefix = `${dir}/`;
      const names = Object.keys(files)
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => p.slice(prefix.length));
      return names.length ? names : undefined;
    },
  };
}

export function asBuildFiles(from: string | BuildFiles): BuildFiles {
  return typeof from === "string" ? dirFiles(from) : from;
}
