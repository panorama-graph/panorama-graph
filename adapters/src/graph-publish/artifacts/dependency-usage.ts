import { libraryKey } from "../../core/keys";
import { artifactEvidence, builder, type Context } from "./context";
import { descendants, type DependencyTree } from "./sbom";

export const SOURCE = "dependency-usage";

/** Configurações do Gradle que declaram dependências do código principal (as de teste ficam de fora). */
const MAIN_CONFIGURATIONS = ["api", "implementation", "compileOnly", "compileOnlyApi", "runtimeOnly", "annotationProcessor"];

export type Declaration = {
  identifier: string;
  version?: string;
  configurationName: string;
  gradleVariantIdentification?: { attributes?: Record<string, string> };
};

export type Usages = {
  usages: {
    coordinates: { type?: string; identifier: string; resolvedVersion?: string };
    usages: { sourceKind: { kind: string }; bucket: string; reasons?: { type: string }[] }[];
  }[];
};

/**
 * Declarado × usado, pelos relatórios brutos do dependency-analysis-gradle-plugin (`declarations.json` e
 * `usages-dependencies.json`). Só o código principal conta, e só entra o que é declarado ou usado.
 *
 * Uma dependência que só agrega outras (starter, BOM de módulo) não tem classe própria e sairia "não usada".
 * Com o SBOM, ela conta como usada quando alguma biblioteca que ela traz (direta ou transitivamente) é usada.
 */
export function mapDependencyUsage(ctx: Context, declarations: Declaration[], usages: Usages, tree?: DependencyTree) {
  const b = builder(ctx, SOURCE);
  const evidence = artifactEvidence(ctx, "dependency-usage/usages-dependencies.json");
  const declEvidence = artifactEvidence(ctx, "dependency-usage/declarations.json");

  const declared = new Map<string, string[]>();
  for (const d of declarations) {
    if (!MAIN_CONFIGURATIONS.includes(d.configurationName)) continue;
    if (d.gradleVariantIdentification?.attributes?.["org.gradle.category"] === "platform") continue;
    declared.set(d.identifier, [...(declared.get(d.identifier) ?? []), d.configurationName]);
  }

  const used = new Set<string>();
  for (const u of usages.usages) {
    const main = u.usages.find((x) => x.sourceKind.kind === "MAIN");
    if (main && main.bucket !== "NONE") used.add(u.coordinates.identifier);
  }

  const keyOf = (identifier: string) => {
    const [group, name] = identifier.split(":");
    return name ? libraryKey("maven", group, name) : undefined;
  };
  const usedKeys = new Set([...used].map(keyOf).filter((k): k is string => !!k));

  for (const id of new Set([...declared.keys(), ...used])) {
    const key = keyOf(id);
    if (!key) {
      b.warn(`dependency-usage: identificador fora do formato grupo:artefato ignorado (${id})`);
      continue;
    }
    const isDeclared = declared.has(id);
    let isUsed = used.has(id);
    if (!isUsed && isDeclared && tree) {
      isUsed = [...descendants(tree, key)].some((k) => usedKeys.has(k));
    }
    b.relation(
      "DEPENDS_ON",
      ctx.component,
      key,
      { declared: isDeclared, used: isUsed, ...(isDeclared ? { scope: declared.get(id)!.join(",") } : {}) },
      isDeclared ? declEvidence : evidence,
    );
  }
  return b;
}
