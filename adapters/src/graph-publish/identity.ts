/**
 * Quem é o componente que está publicando: caminho do repositório, host, commit e nome de serviço.
 * Vem do manifesto do build e das variáveis do CI (GitLab ou GitHub), com as opções do CLI por cima.
 */

export type Manifest = {
  format?: string;
  component?: { group?: string; name?: string; version?: string; repository?: string; commit?: string };
  technologies?: { name: string; version?: string }[];
  /** Pacotes que o build gera, pelo purl com a versão (ex.: `pkg:maven/org.example/lib@1.0.0`). */
  packages?: { purl: string }[];
  artifacts?: Record<string, string>;
};

export type Identity = {
  /** Caminho do repositório no provedor (ex.: `acme/credito/product-catalog-api`): a chave do componente. */
  path: string;
  /** Host do provedor, sem usuário nem porta (ex.: `gitlab.acmebank.example`). */
  host: string;
  /** URL do repositório, como o CI ou o `git remote` a conhecem. */
  url?: string;
  commit: string;
  /** Nome com que os clientes conhecem o serviço (participante nos pacts, grupo dos clientes HTTP). */
  service: string;
  version?: string;
};

export type IdentityOverrides = { path?: string; host?: string; commit?: string; service?: string };

type Env = Record<string, string | undefined>;

/** Host e caminho de uma URL de repositório: `ssh://git@host:2224/a/b.git`, `git@host:a/b.git` ou `https://host/a/b`. */
export function parseRepositoryUrl(url: string): { host: string; path: string } | undefined {
  const scp = /^[^@/\s]+@([^:/\s]+):(?!\d+\/)(.+?)(?:\.git)?\/?$/.exec(url);
  if (scp) return { host: scp[1], path: scp[2] };
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/$/, "");
    return path ? { host: u.hostname, path } : undefined;
  } catch {
    return undefined;
  }
}

export function resolveIdentity(
  manifest: Manifest | undefined,
  applicationName: string | undefined,
  env: Env,
  overrides: IdentityOverrides = {},
): Identity {
  const fromManifest = manifest?.component?.repository ? parseRepositoryUrl(manifest.component.repository) : undefined;
  const ciHost = env.CI_SERVER_HOST ?? (env.GITHUB_SERVER_URL ? new URL(env.GITHUB_SERVER_URL).hostname : undefined);
  const ciPath = env.CI_PROJECT_PATH ?? env.GITHUB_REPOSITORY;

  const path = overrides.path ?? ciPath ?? fromManifest?.path;
  const host = overrides.host ?? ciHost ?? fromManifest?.host;
  const commit = overrides.commit ?? env.CI_COMMIT_SHA ?? env.GITHUB_SHA ?? manifest?.component?.commit;
  const url =
    env.CI_PROJECT_URL ??
    (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}` : undefined) ??
    manifest?.component?.repository;

  const missing = [!path && "caminho do repositório", !host && "host do repositório", !commit && "commit"].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Não foi possível identificar o componente (${missing.join(", ")}). ` +
        "Rode no CI, gere o manifest.json num repositório git ou informe --component, --host e --commit.",
    );
  }
  const service = overrides.service ?? applicationName ?? path!.split("/").pop()!;
  return { path: path!, host: host!, commit: commit!, service, ...(url ? { url } : {}), ...(manifest?.component?.version ? { version: manifest.component.version } : {}) };
}
