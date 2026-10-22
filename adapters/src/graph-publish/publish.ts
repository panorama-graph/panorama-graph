import type { Snapshot, SnapshotBuilder } from "../core/snapshot";
import { mapAsyncApi } from "./artifacts/asyncapi";
import { createContext } from "./artifacts/context";
import { mapDataAccess, type DataAccess } from "./artifacts/data-access";
import { mapDependencyUsage } from "./artifacts/dependency-usage";
import { mapHttpClients, operationsByService, type HttpClients } from "./artifacts/http-clients";
import { mapManifest } from "./artifacts/manifest";
import { mapOpenApi } from "./artifacts/openapi";
import { mapPacts, type Pact } from "./artifacts/pact";
import { dependencyTree, mapSbom, type CycloneDx } from "./artifacts/sbom";
import { asBuildFiles, type BuildFiles } from "./bundle";
import { checkFormat, type ArtifactFormat } from "./formats";
import { resolveIdentity, type Identity, type IdentityOverrides, type Manifest } from "./identity";

export type PublishOptions = {
  overrides?: IdentityOverrides;
  kind?: string;
  /** Caminho do diretório de artefatos relativo à raiz do repositório, para a evidência. */
  artifactsDir?: string;
  env?: Record<string, string | undefined>;
  /** Retrato congelado do commit: o escopo leva o commit, e o retrato só vale no recorte de um ambiente em que ele roda. */
  frozen?: boolean;
  /** Versão do artefato (padrão: a do manifest.json). */
  version?: string;
};

export type Plan = { identity: Identity; snapshots: Snapshot[]; warnings: string[]; skipped: string[] };

/**
 * Lê os artefatos de arquitetura de um build (um diretório ou os arquivos recebidos pelo graph-receiver) e monta um
 * retrato por artefato presente.
 * Artefato ausente não gera retrato: a API mantém o último que recebeu daquela fonte. Artefato presente e
 * vazio (ex.: nenhum cliente HTTP) gera retrato vazio, e o que a fonte afirmava antes vira `stale`.
 */
export function planPublish(from: string | BuildFiles, observedAt: string, opts: PublishOptions = {}): Plan {
  const files = asBuildFiles(from);
  const read = <T>(file: string): T | undefined => files.read(file) as T | undefined;
  const formatWarnings: string[] = [];
  const checked = <T extends { format?: string }>(artifact: ArtifactFormat, doc: T | undefined): T | undefined => {
    const warning = doc && checkFormat(artifact, doc);
    if (warning) formatWarnings.push(warning);
    return doc;
  };

  const manifest = checked("manifest", read<Manifest>("manifest.json"));
  const application = checked("application", read<{ format?: string; name?: string }>("application.json"));
  const resolved = resolveIdentity(manifest, application?.name, opts.env ?? process.env, opts.overrides);
  const identity = opts.version ? { ...resolved, version: opts.version } : resolved;
  const ctx = createContext(identity, { artifactsDir: opts.artifactsDir, kind: opts.kind, frozen: opts.frozen });

  const builders: SnapshotBuilder[] = [mapManifest(ctx, manifest)];
  const skipped: string[] = [];

  const bom = read<CycloneDx>("bom.json");
  const tree = bom ? dependencyTree(bom) : undefined;
  if (bom) builders.push(mapSbom(ctx, bom));
  else skipped.push("sbom (bom.json)");

  const declarations = read<Parameters<typeof mapDependencyUsage>[1]>("dependency-usage/declarations.json");
  const usages = read<Parameters<typeof mapDependencyUsage>[2]>("dependency-usage/usages-dependencies.json");
  if (declarations && usages) builders.push(mapDependencyUsage(ctx, declarations, usages, tree));
  else skipped.push("dependency-usage (dependency-usage/*.json)");

  const openapi = read<Parameters<typeof mapOpenApi>[1]>("openapi.json");
  if (openapi) builders.push(mapOpenApi(ctx, openapi));
  else skipped.push("openapi (openapi.json)");

  const asyncapi = read<Parameters<typeof mapAsyncApi>[1]>("asyncapi.json");
  if (asyncapi) builders.push(mapAsyncApi(ctx, asyncapi));
  else skipped.push("asyncapi (asyncapi.json)");

  const clients = checked("httpClients", read<HttpClients>("http-clients.json"));
  if (clients) builders.push(mapHttpClients(ctx, clients));
  else skipped.push("http-clients (http-clients.json)");

  const dataAccess = checked("dataAccess", read<DataAccess>("data-access.json"));
  if (dataAccess) builders.push(mapDataAccess(ctx, dataAccess));
  else skipped.push("data-access (data-access.json)");

  const pactFiles = files.list("pacts");
  if (pactFiles) {
    const pacts = pactFiles
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((file) => ({ file, pact: read<Pact>(`pacts/${file}`)! }));
    builders.push(mapPacts(ctx, pacts, operationsByService(clients)));
  } else {
    skipped.push("pact (pacts/)");
  }

  // Todo retrato diz de que versão do componente é: na linha principal, só o registro; no congelado, a identidade.
  const revision = { component: ctx.component, commit: identity.commit, ...(identity.version ? { version: identity.version } : {}) };
  return {
    identity,
    snapshots: builders.map((b) => ({ ...b.build(observedAt), revision })),
    warnings: [...formatWarnings, ...builders.flatMap((b) => b.warnings)],
    skipped,
  };
}
