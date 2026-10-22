import { createJsonSchemaTransformObject } from "fastify-type-provider-zod";
import { z } from "zod";
import type { GraphDb } from "../db/neo4j";
import { errorBodySchema } from "../errors";
import { ingestBodySchema } from "../ingest/payload";
import type { QueryService } from "../query/QueryService";
import { argsName, queryDefinitions, resultName, toJsonSchemas } from "../query/contract";
import { queryTools } from "../query/tools";
import { retireBodySchema } from "./ingest";
import { aliasBodySchema, mergeBodySchema } from "./nodes";
import {
  aliasResultSchema,
  ingestResultSchema,
  mergeResultSchema,
  modelDescriptionSchema,
  propSpecSchema,
  queryContractDocumentSchema,
  retireResultSchema,
} from "./schemas";

/** Corpos e respostas das rotas que não são consultas, com nome próprio no OpenAPI (e um tipo do SDK cada). */
const REST_SCHEMAS = {
  Snapshot: ingestBodySchema,
  IngestResult: ingestResultSchema,
  ScopeRetirement: retireBodySchema,
  RetireResult: retireResultSchema,
  AliasRequest: aliasBodySchema,
  AliasResult: aliasResultSchema,
  MergeRequest: mergeBodySchema,
  MergeResult: mergeResultSchema,
  ModelDescription: modelDescriptionSchema,
  PropSpec: propSpecSchema,
  QueryContractDocument: queryContractDocumentSchema,
} satisfies Record<string, z.ZodTypeAny>;

type Operation = { method: "get" | "post"; path: string; request?: string; response: string };

const REST_OPERATIONS: Operation[] = [
  { method: "get", path: "/v1/schema", response: "ModelDescription" },
  { method: "post", path: "/v1/ingest", request: "Snapshot", response: "IngestResult" },
  { method: "post", path: "/v1/scopes/retire", request: "ScopeRetirement", response: "RetireResult" },
  { method: "post", path: "/v1/nodes/{key}/aliases", request: "AliasRequest", response: "AliasResult" },
  { method: "post", path: "/v1/nodes/merge", request: "MergeRequest", response: "MergeResult" },
  { method: "get", path: "/v1/queries", response: "QueryContractDocument" },
];

type OpenApiDoc = {
  paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: unknown }> }; responses: Record<string, { content?: Record<string, { schema: unknown }> }> }>>;
  components: { schemas: Record<string, unknown> };
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/**
 * Monta o documento OpenAPI com os corpos e as respostas tipados: o erro (`Error`), as formas das consultas
 * (argumentos, respostas e as compartilhadas, de `queryDefinitions`) e as das demais rotas, cada uma em
 * `components.schemas`, e as operações apontando para elas. O Fastify continua serializando a resposta sem
 * validar: o esquema é o contrato publicado, e os testes conferem as respostas contra ele.
 */
export function openApiTransformObject() {
  const base = createJsonSchemaTransformObject({ schemas: { Error: errorBodySchema } });
  const tools = queryTools({} as QueryService, {} as GraphDb);
  const schemas = { ...queryDefinitions(tools, "openApi3", { args: true }), ...toJsonSchemas(REST_SCHEMAS, "openApi3") };
  const operations: Operation[] = [
    ...REST_OPERATIONS,
    ...tools.map((t) => ({ method: "post" as const, path: `/v1/queries/${t.name}`, request: argsName(t), response: resultName(t) })),
  ];

  return (input: Parameters<ReturnType<typeof createJsonSchemaTransformObject>>[0]) => {
    const doc = base(input) as unknown as OpenApiDoc;
    doc.components.schemas = { ...doc.components.schemas, ...schemas };
    for (const op of operations) {
      const operation = doc.paths[op.path]?.[op.method];
      if (!operation) throw new Error(`OpenAPI: operação ${op.method.toUpperCase()} ${op.path} não existe`);
      if (op.request && operation.requestBody) operation.requestBody.content["application/json"].schema = ref(op.request);
      const success = operation.responses["2XX"];
      if (success?.content) success.content["application/json"].schema = ref(op.response);
    }
    return doc as never;
  };
}
