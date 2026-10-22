import { libraryKey, parsePurl } from "../../core/keys";
import { artifactEvidence, builder, type Context } from "./context";

export const SOURCE = "sbom";

type CdxComponent = { "bom-ref"?: string; type?: string; group?: string; name: string; version?: string; purl?: string; scope?: string };
export type CycloneDx = {
  bomFormat?: string;
  metadata?: { component?: CdxComponent };
  components?: CdxComponent[];
  dependencies?: { ref: string; dependsOn?: string[] }[];
};

export type Library = { key: string; name: string; version?: string };

/** Árvore de dependências do SBOM por chave de biblioteca: quem cada uma traz, e quais são diretas. */
export type DependencyTree = { libraries: Map<string, Library>; direct: Set<string>; children: Map<string, Set<string>> };

export function dependencyTree(bom: CycloneDx): DependencyTree {
  const byRef = new Map<string, Library>();
  for (const c of bom.components ?? []) {
    const lib = libraryOf(c);
    if (lib && c["bom-ref"]) byRef.set(c["bom-ref"], lib);
  }
  const libraries = new Map([...byRef.values()].map((l) => [l.key, l]));
  const rootRef = bom.metadata?.component?.["bom-ref"];
  const children = new Map<string, Set<string>>();
  const direct = new Set<string>();
  for (const d of bom.dependencies ?? []) {
    const deps = (d.dependsOn ?? []).map((r) => byRef.get(r)?.key).filter((k): k is string => !!k);
    if (d.ref === rootRef) deps.forEach((k) => direct.add(k));
    const from = byRef.get(d.ref)?.key;
    if (from) children.set(from, new Set([...(children.get(from) ?? []), ...deps]));
  }
  return { libraries, direct, children };
}

/** Todas as bibliotecas que chegam ao componente por `key`, sem ela mesma. */
export function descendants(tree: DependencyTree, key: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(tree.children.get(key) ?? [])];
  while (stack.length) {
    const k = stack.pop()!;
    if (seen.has(k) || k === key) continue;
    seen.add(k);
    stack.push(...(tree.children.get(k) ?? []));
  }
  return seen;
}

/** Para cada transitiva, as dependências diretas que a trazem (por qualquer caminho da árvore). */
export function bringers(tree: DependencyTree): Map<string, string[]> {
  const via = new Map<string, Set<string>>();
  for (const d of tree.direct) {
    for (const k of descendants(tree, d)) {
      if (!tree.direct.has(k)) via.set(k, (via.get(k) ?? new Set()).add(d));
    }
  }
  return new Map([...via].map(([k, ds]) => [k, [...ds].sort()]));
}

/**
 * Bibliotecas do SBOM (diretas e transitivas), com a versão resolvida. O SBOM que o plugin gera é o do classpath de
 * execução, daí `scope: runtime`. Um componente sem purl (ex.: o próprio projeto) fica de fora. Na transitiva,
 * `via` diz por quais dependências diretas ela chega: o que atualizar para trocar a versão dela.
 */
export function mapSbom(ctx: Context, bom: CycloneDx) {
  const b = builder(ctx, SOURCE);
  const evidence = artifactEvidence(ctx, "bom.json");
  const tree = dependencyTree(bom);
  const via = bringers(tree);
  for (const lib of tree.libraries.values()) {
    b.node(lib.key, "Library", { name: lib.name }, evidence);
    const direct = tree.direct.has(lib.key);
    b.relation(
      "DEPENDS_ON",
      ctx.component,
      lib.key,
      {
        ...(lib.version ? { version: lib.version } : {}),
        scope: "runtime",
        resolved: true,
        direct,
        ...(!direct && via.has(lib.key) ? { via: via.get(lib.key)! } : {}),
      },
      evidence,
    );
  }
  if (tree.direct.size === 0) b.warn("sbom: o SBOM não diz quais dependências são diretas (sem dependencies do componente raiz)");
  return b;
}

function libraryOf(c: CdxComponent): Library | undefined {
  if (c.type && !["library", "framework"].includes(c.type)) return undefined;
  const lib = c.purl ? libraryFromPurl(c.purl) : undefined;
  if (!lib) return undefined;
  const version = c.version ?? lib.version;
  return { key: lib.key, name: lib.name, ...(version ? { version } : {}) };
}

/** A biblioteca de um purl (`pkg:maven/org.example/lib@1.0`): chave sem versão, nome legível e a versão, se houver. */
export function libraryFromPurl(purl: string): Library | undefined {
  const p = parsePurl(purl);
  if (!p) return undefined;
  const name = p.namespace && p.type === "maven" ? `${p.namespace}:${p.name}` : p.namespace ? `${p.namespace}/${p.name}` : p.name;
  return { key: libraryKey(p.type, p.namespace, p.name), name, ...(p.version ? { version: p.version } : {}) };
}
