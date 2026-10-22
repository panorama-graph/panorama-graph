import { repositoryKey, technologyKey } from "../../core/keys";
import type { Manifest } from "../identity";
import { artifactEvidence, builder, type Context } from "./context";
import { libraryFromPurl } from "./sbom";

export const SOURCE = "build-manifest";

/**
 * O próprio componente, o repositório em que ele está, a stack com que é construído e os pacotes que o build gera
 * (`PRODUCES`): o que liga o componente de uma biblioteca aos usos dela nos outros componentes.
 */
export function mapManifest(ctx: Context, manifest: Manifest | undefined) {
  const b = builder(ctx, SOURCE);
  const evidence = artifactEvidence(ctx, "manifest.json");
  const repo = repositoryKey(ctx.id.host, ctx.id.path);
  const name = ctx.id.path.split("/").pop()!;

  b.node(ctx.component, "Component", { name, kind: ctx.kind }, evidence);
  b.node(repo, "Repository", { name: ctx.id.path, ...(ctx.id.url ? { url: ctx.id.url } : {}) }, evidence);
  b.relation("HOSTED_IN", ctx.component, repo, {}, evidence);

  for (const t of manifest?.technologies ?? []) {
    if (!t?.name) continue;
    b.node(technologyKey(t.name), "Technology", { name: t.name }, evidence);
    b.relation("BUILT_WITH", ctx.component, technologyKey(t.name), t.version ? { version: t.version } : {}, evidence);
  }

  for (const p of manifest?.packages ?? []) {
    const lib = p?.purl ? libraryFromPurl(p.purl) : undefined;
    if (!lib) {
      b.warn(`build-manifest: pacote sem purl válido (${JSON.stringify(p)})`);
      continue;
    }
    b.node(lib.key, "Library", { name: lib.name }, evidence);
    b.relation("PRODUCES", ctx.component, lib.key, lib.version ? { version: lib.version } : {}, evidence);
  }
  return b;
}
