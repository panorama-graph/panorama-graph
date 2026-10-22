/**
 * Conferência do retrato contra o modelo do SDK, antes do envio: o `--dry-run` acha o erro sem precisar da API.
 * A API valida de novo e é quem decide; isto só antecipa os erros mais comuns.
 */
import { NODE_TYPES, nodeTypeFromKey, RELATION_TYPES, type Snapshot } from "@panorama-graph/sdk";

type PropSpecs = Record<string, { type: string; enum?: readonly string[]; required?: boolean }>;

export function checkSnapshot(s: Snapshot): string[] {
  const errors: string[] = [];
  const where = `${s.source} ${JSON.stringify(s.scope)}`;
  const evidenceOf = (e?: string) => e ?? s.evidenceBase;

  for (const n of s.nodes ?? []) {
    const spec = NODE_TYPES[n.type as keyof typeof NODE_TYPES];
    if (!spec) errors.push(`${where}: nó "${n.key}" com tipo desconhecido "${n.type}"`);
    else if (nodeTypeFromKey(n.key) !== n.type) errors.push(`${where}: nó "${n.key}" não tem o prefixo de ${n.type} (${spec.prefix}:)`);
    else errors.push(...checkProps(spec.props as PropSpecs, n.props ?? {}, `${where}: nó "${n.key}"`));
    if (!evidenceOf(n.evidence)) errors.push(`${where}: nó "${n.key}" sem evidência`);
  }
  for (const r of s.relations ?? []) {
    const label = `${where}: ${r.type} ${r.from} → ${r.to}`;
    const spec = RELATION_TYPES[r.type as keyof typeof RELATION_TYPES];
    if (!spec) {
      errors.push(`${label}: relação desconhecida`);
      continue;
    }
    const from = nodeTypeFromKey(r.from);
    const to = nodeTypeFromKey(r.to);
    if (!spec.pairs.some((p) => p.from === from && p.to === to)) errors.push(`${label}: par ${from} → ${to} não é aceito`);
    errors.push(...checkProps(spec.props as PropSpecs, r.props ?? {}, label));
    if (!evidenceOf(r.evidence)) errors.push(`${label}: sem evidência`);
  }
  return errors;
}

function ofType(type: string, value: unknown): boolean {
  if (type === "string[]") return Array.isArray(value) && value.every((v) => typeof v === "string");
  return typeof value === type;
}

function checkProps(specs: PropSpecs, props: Record<string, unknown>, label: string): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(props)) {
    const spec = specs[name];
    if (!spec) errors.push(`${label}: propriedade "${name}" não existe no modelo`);
    else if (!ofType(spec.type, value)) errors.push(`${label}: "${name}" deve ser ${spec.type}`);
    else if (spec.enum && !spec.enum.includes(value as string)) errors.push(`${label}: "${name}" = "${value}" fora de ${spec.enum.join(", ")}`);
  }
  for (const [name, spec] of Object.entries(specs)) if (spec.required && !(name in props)) errors.push(`${label}: falta "${name}"`);
  return errors;
}
