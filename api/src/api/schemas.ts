import { z } from "zod";
import { FACT_STATES, FACT_STATUSES, NODE_TYPE_NAMES, RELATION_TYPE_NAMES, type NodeType, type RelationType } from "../model/model";

/**
 * Respostas das rotas do REST que não são consultas: a ingestão, a identidade dos nós, o modelo e o contrato das
 * consultas. Como as das consultas (`query/responses.ts`), documentam e não validam: os testes conferem.
 */

const scope = z.record(z.string());
const outcomeCounts = z.object({ created: z.number(), updated: z.number(), unchanged: z.number(), stale: z.number() });

export const ingestResultSchema = z
  .object({
    loadId: z.string(),
    source: z.string(),
    scope,
    observedAt: z.string(),
    counts: z.object({ nodes: outcomeCounts, relations: outcomeCounts, referenced: z.number() }),
    dryRun: z.literal(true).optional().describe("A carga foi só conferida (dryRun): nada foi gravado"),
  })
  .describe("Resultado de uma carga: o que foi criado, alterado, ficou igual e virou stale");

export const retireResultSchema = z.object({
  scope,
  observedAt: z.string(),
  sources: z.array(
    z.object({
      source: z.string(),
      loadId: z.string(),
      counts: z.object({ nodes: z.object({ stale: z.number() }), relations: z.object({ stale: z.number() }) }),
    }),
  ),
});

export const aliasResultSchema = z.object({ key: z.string(), alias: z.string(), created: z.boolean() });

const moved = z.object({ moved: z.number(), deduplicated: z.number() });
export const mergeResultSchema = z.object({
  mergeId: z.string(),
  from: z.string(),
  into: z.string(),
  relations: moved,
  claims: moved,
  aliases: z.array(z.string()),
});

export const propSpecSchema = z.object({
  type: z.enum(["string", "number", "boolean", "string[]"]),
  enum: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  description: z.string(),
});

export const modelDescriptionSchema = z
  .object({
    modelVersion: z.number(),
    keyFormat: z.string(),
    nodeTypes: z.array(
      z.object({
        type: z.enum(NODE_TYPE_NAMES as [NodeType, ...NodeType[]]),
        prefix: z.string(),
        description: z.string(),
        props: z.record(propSpecSchema),
      }),
    ),
    relationTypes: z.array(
      z.object({
        type: z.enum(RELATION_TYPE_NAMES as [RelationType, ...RelationType[]]),
        description: z.string(),
        nature: z.string(),
        pairs: z.array(z.object({ from: z.string(), to: z.string() })),
        props: z.record(propSpecSchema),
        identityProps: z.array(z.string()),
      }),
    ),
    provenance: z.object({
      fields: z.array(z.string()),
      states: z.array(z.enum(FACT_STATES)),
      statuses: z.array(z.enum(FACT_STATUSES)),
      rules: z.array(z.string()),
    }),
    queryContractVersion: z.number(),
  })
  .describe("O modelo: tipos de nó e de relação, pares válidos, chaves e proveniência");

const deprecation = z.object({ since: z.number(), use: z.string() });
export const queryContractDocumentSchema = z
  .object({
    version: z.number(),
    policy: z.array(z.string()),
    tools: z.array(
      z.object({
        name: z.string(),
        since: z.number(),
        stability: z.enum(["stable", "exploratory"]),
        deprecated: deprecation.optional(),
        args: z.record(
          z.object({ type: z.string(), required: z.boolean(), enum: z.array(z.string()).optional(), deprecated: deprecation.optional() }),
        ),
        description: z.string(),
      }),
    ),
  })
  .describe("O contrato das consultas: versão, política e as ferramentas com os argumentos");
