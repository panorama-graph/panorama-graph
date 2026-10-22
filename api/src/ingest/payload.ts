import { z } from "zod";
import { checkKey } from "../model/keys";
import {
  PROVENANCE_FIELDS,
  isNodeType,
  isRelationType,
  isValidPair,
  nodeProps,
  relationSpec,
  validateProps,
  type NodeType,
  type RelationType,
} from "../model/model";

const propsSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])).optional();

/** Forma do payload. `.strict()` recusa campos extras, inclusive `state`: o /ingest só grava `observed`. */
export const ingestBodySchema = z
  .object({
    source: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "source: minúsculas, dígitos e hífen, começando por letra")
      .describe("Adaptador que afirma os fatos (ex.: pact-broker)"),
    scope: z
      .record(z.string())
      .default({})
      .describe("Escopo do retrato. Fatos da mesma source e escopo ausentes nesta carga viram stale"),
    observedAt: z.string().datetime({ offset: true }).describe("Quando a fonte foi lida (ISO 8601)"),
    evidenceBase: z
      .string()
      .min(1)
      .optional()
      .describe("Prefixo de evidência comum; a evidência de cada fato é concatenada a ele"),
    revision: z
      .object({
        component: z.string().describe("Componente de que o retrato é uma versão (chave component:...)"),
        commit: z.string().min(1).describe("Commit de que os artefatos lidos foram construídos"),
        version: z.string().min(1).optional().describe("Versão do artefato (rótulo, ex.: 1.4.0 ou 1.5.0-SNAPSHOT)"),
      })
      .strict()
      .optional()
      .describe(
        "De que versão do componente é o retrato. Com a chave `commit` no escopo, é um retrato congelado daquele commit: " +
          "só aparece no recorte de um ambiente em que o commit está implantado (DEPLOYED_IN). Sem ela, é o retrato da " +
          "linha principal, e a revisão diz de que commit ele é",
      ),
    producer: z
      .object({
        name: z.string().min(1).describe("Programa que montou o retrato (ex.: graph-publish)"),
        version: z.string().min(1).describe("Versão do programa (ex.: 0.2.0)"),
      })
      .strict()
      .optional()
      .describe(
        "Quem montou o retrato a partir da fonte, e em que versão. Fica no escopo: quem relê a mesma fonte com uma " +
          "versão mais nova (que extrai mais) sabe que o retrato pode mudar, e o refaz (ex.: o retrato congelado de um commit)",
      ),
    nodes: z
      .array(
        z
          .object({
            key: z.string(),
            type: z.string(),
            props: propsSchema,
            evidence: z.string().min(1).optional(),
          })
          .strict(),
      )
      .default([]),
    relations: z
      .array(
        z
          .object({
            type: z.string(),
            from: z.string(),
            to: z.string(),
            props: propsSchema,
            evidence: z.string().min(1).optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type IngestBody = z.infer<typeof ingestBodySchema>;

export type Props = Record<string, string | number | boolean | string[]>;

export type NodeFact = { key: string; type: NodeType; props: Props; evidence: string };
export type RelationFact = {
  type: RelationType;
  from: string;
  to: string;
  fromType: NodeType;
  toType: NodeType;
  props: Props;
  evidence: string;
};

/** De que versão de um componente é o retrato. `frozen`: retrato congelado de um commit (escopo com `commit`). */
export type Revision = { component: string; commit: string; version?: string; frozen: boolean };

/** Programa e versão que montaram o retrato. */
export type Producer = { name: string; version: string };

export type Snapshot = {
  source: string;
  scope: Record<string, string>;
  scopeKey: string;
  observedAt: string;
  revision?: Revision;
  producer?: Producer;
  nodes: NodeFact[];
  relations: RelationFact[];
};

export type Validation = { ok: true; snapshot: Snapshot } | { ok: false; errors: string[] };

/** JSON com as chaves ordenadas: o mesmo escopo gera sempre a mesma string. */
export function canonicalScope(scope: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(scope).sort(([a], [b]) => a.localeCompare(b))));
}

function withoutNulls(props: Record<string, string | number | boolean | string[] | null> | undefined): Props {
  return Object.fromEntries(Object.entries(props ?? {}).filter(([, v]) => v !== null)) as Props;
}

function reservedProps(props: Record<string, unknown> | undefined, where: string): string[] {
  const reserved = new Set<string>([...PROVENANCE_FIELDS, "key", "type"]);
  return Object.keys(props ?? {})
    .filter((p) => reserved.has(p))
    .map((p) => `${where}: "${p}" é campo reservado`);
}

export function resolveEvidence(base: string | undefined, own: string | undefined): string | undefined {
  if (base && own) return base + own;
  return own ?? base;
}

/** Identidade de uma afirmação de relação dentro de uma carga (a source e o escopo já são os da carga). */
export function relationIdentity(r: { type: RelationType; from: string; to: string; props: Props }): string {
  const idProps = relationSpec(r.type).identityProps.map((p) => r.props[p] ?? "");
  return JSON.stringify([r.type, r.from, r.to, ...idProps]);
}

/** Valida o payload contra o modelo. Tudo ou nada: qualquer erro recusa a carga inteira. */
export function validateSnapshot(body: IngestBody): Validation {
  const errors: string[] = [];
  const nodes: NodeFact[] = [];
  const relations: RelationFact[] = [];
  const seenNodes = new Set<string>();
  const seenRelations = new Set<string>();

  const frozen = "commit" in body.scope;
  if (body.revision) {
    const k = checkKey(body.revision.component);
    if (!k.ok) errors.push(`revision.component: ${k.error}`);
    else if (k.type !== "Component") errors.push(`revision.component: a chave é de ${k.type}, e não de Component`);
    if (frozen && body.scope.commit !== body.revision.commit) {
      errors.push(`scope.commit (${body.scope.commit}) e revision.commit (${body.revision.commit}) precisam ser o mesmo commit`);
    }
  } else if (frozen) {
    errors.push("scope com commit é um retrato congelado: informe revision (component e commit)");
  }

  body.nodes.forEach((n, i) => {
    const where = `nodes[${i}] (${n.key})`;
    if (!isNodeType(n.type)) {
      errors.push(`${where}: tipo de nó desconhecido "${n.type}"`);
      return;
    }
    const k = checkKey(n.key);
    if (!k.ok) return void errors.push(`${where}: ${k.error}`);
    if (k.type !== n.type) return void errors.push(`${where}: a chave é de ${k.type}, mas o tipo declarado é ${n.type}`);
    if (seenNodes.has(n.key)) return void errors.push(`${where}: nó repetido na carga`);
    seenNodes.add(n.key);
    errors.push(...reservedProps(n.props, where));
    errors.push(...validateProps(nodeProps(n.type), n.props ?? {}, where));
    const evidence = resolveEvidence(body.evidenceBase, n.evidence);
    if (!evidence) errors.push(`${where}: sem evidência (informe evidence ou evidenceBase)`);
    nodes.push({ key: n.key, type: n.type, props: withoutNulls(n.props), evidence: evidence ?? "" });
  });

  body.relations.forEach((r, i) => {
    const where = `relations[${i}] (${r.from} -${r.type}-> ${r.to})`;
    if (!isRelationType(r.type)) return void errors.push(`${where}: tipo de relação desconhecido "${r.type}"`);
    const from = checkKey(r.from);
    const to = checkKey(r.to);
    if (!from.ok) errors.push(`${where}: from: ${from.error}`);
    if (!to.ok) errors.push(`${where}: to: ${to.error}`);
    if (!from.ok || !to.ok) return;
    if (!isValidPair(r.type, from.type, to.type)) {
      const pairs = relationSpec(r.type).pairs.map(([f, t]) => `${f}→${t}`).join(", ");
      return void errors.push(`${where}: ${r.type} não liga ${from.type}→${to.type} (pares válidos: ${pairs})`);
    }
    errors.push(...reservedProps(r.props, where));
    errors.push(...validateProps(relationSpec(r.type).props, r.props ?? {}, where));
    const evidence = resolveEvidence(body.evidenceBase, r.evidence);
    if (!evidence) errors.push(`${where}: sem evidência (informe evidence ou evidenceBase)`);
    const fact: RelationFact = {
      type: r.type,
      from: r.from,
      to: r.to,
      fromType: from.type,
      toType: to.type,
      props: withoutNulls(r.props),
      evidence: evidence ?? "",
    };
    const id = relationIdentity(fact);
    if (seenRelations.has(id)) return void errors.push(`${where}: relação repetida na carga`);
    seenRelations.add(id);
    relations.push(fact);
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    snapshot: {
      source: body.source,
      scope: body.scope,
      scopeKey: canonicalScope(body.scope),
      observedAt: new Date(body.observedAt).toISOString(),
      ...(body.revision ? { revision: { ...body.revision, frozen } } : {}),
      ...(body.producer ? { producer: body.producer } : {}),
      nodes,
      relations,
    },
  };
}
