/**
 * Arquivos gerados do SDK em TypeScript (`sdks/typescript/src/generated/`), a partir do contrato que esta API publica:
 *
 *   types.ts   os tipos de cada corpo e resposta do REST, do snapshot `contract/openapi-v1.json`, e o mapa
 *              consulta → argumentos e resposta, com a versão do contrato das consultas;
 *   model.ts   o modelo (`GET /v1/schema`): versão, tipos de nó com o prefixo da chave e tipos de relação.
 *
 *   bun run sdk:generate   grava os dois arquivos
 *
 * O teste `sdk.test.ts` falha quando o contrato muda e os arquivos não: toda mudança no OpenAPI ou no modelo
 * termina com `bun run openapi:write && bun run sdk:generate`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";
import { API_PREFIX } from "../src/api/rest";
import type { GraphDb } from "../src/db/neo4j";
import { describeModel } from "../src/model/describe";
import type { QueryService } from "../src/query/QueryService";
import { QUERY_CONTRACT_VERSION, argsName, resultName } from "../src/query/contract";
import { queryTools } from "../src/query/tools";
import { openApiPath } from "./openapi";

const OUT = join(import.meta.dir, "..", "..", "sdks", "typescript", "src", "generated");
export const sdkTypesPath = join(OUT, "types.ts");
export const sdkModelPath = join(OUT, "model.ts");

const HEADER = (from: string) =>
  `// Gerado por \`bun run sdk:generate\` no panorama-graph-api, a partir de ${from}. Não edite à mão.\n\n`;

/** Nomes dos componentes que colidem com nomes globais do TypeScript. */
const RENAMED: Record<string, string> = { Error: "ErrorBody" };

export async function sdkTypes(): Promise<string> {
  const doc = JSON.parse(readFileSync(openApiPath, "utf8")) as { components: { schemas: Record<string, unknown> } };
  // Só os componentes: as operações ficam no cliente, que conhece as rotas.
  const ast = await openapiTS({ ...doc, paths: {} } as never, { exportType: true, additionalProperties: false, alphabetize: false, defaultNonNullable: false });
  const components = astToString(ast)
    .split("\n")
    .filter((line) => !/^export type (paths|webhooks|\$defs|operations) = Record<string, never>;$/.test(line))
    .join("\n")
    .trim();
  const aliases = Object.keys(doc.components.schemas).map(
    (name) => `export type ${RENAMED[name] ?? name} = components["schemas"]["${name}"];`,
  );
  const tools = queryTools({} as QueryService, {} as GraphDb);
  const names = tools.map((t) => t.name);
  return (
    HEADER("contract/openapi-v1.json") +
    `${components}\n\n${aliases.join("\n")}\n\n` +
    `/** Versão do contrato das consultas que estes tipos descrevem (\`GET ${API_PREFIX}/queries\`). */\n` +
    `export const QUERY_CONTRACT_VERSION = ${QUERY_CONTRACT_VERSION};\n\n` +
    `/** Prefixo das rotas do REST. */\nexport const API_PREFIX = "${API_PREFIX}";\n\n` +
    `/** As consultas, servidas igual pelo REST (\`POST ${API_PREFIX}/queries/<nome>\`) e pelo MCP. */\n` +
    `export const QUERY_NAMES = ${JSON.stringify(names, null, 2)} as const;\n\n` +
    `export type QueryName = (typeof QUERY_NAMES)[number];\n\n` +
    `/** Argumentos de cada consulta. */\nexport type QueryArgs = {\n${tools.map((t) => `  ${t.name}: ${argsName(t)};`).join("\n")}\n};\n\n` +
    `/** Resposta de cada consulta (com detail full; em summary, as afirmações vêm resumidas). */\n` +
    `export type QueryResults = {\n${tools.map((t) => `  ${t.name}: ${resultName(t)};`).join("\n")}\n};\n`
  );
}

export function sdkModel(): string {
  const model = describeModel();
  const nodeTypes = Object.fromEntries(model.nodeTypes.map(({ type, ...spec }) => [type, spec]));
  const relationTypes = Object.fromEntries(model.relationTypes.map(({ type, ...spec }) => [type, spec]));
  return (
    HEADER("src/model (o mesmo documento do GET /v1/schema)") +
    `/** Versão do modelo do grafo: tipos de nó, de relação e propriedades que a API aceita na carga. */\n` +
    `export const MODEL_VERSION = ${model.modelVersion};\n\n` +
    `/** Formato das chaves: o prefixo determina o tipo do nó. */\nexport const KEY_FORMAT = ${JSON.stringify(model.keyFormat)};\n\n` +
    `/** Tipos de nó, com o prefixo da chave e as propriedades. */\n` +
    `export const NODE_TYPES = ${JSON.stringify(nodeTypes, null, 2)} as const;\n\n` +
    `/** Tipos de relação, com os pares válidos, as propriedades e as de identidade. */\n` +
    `export const RELATION_TYPES = ${JSON.stringify(relationTypes, null, 2)} as const;\n\n` +
    `export type NodeType = keyof typeof NODE_TYPES;\nexport type RelationType = keyof typeof RELATION_TYPES;\n`
  );
}

if (import.meta.main) {
  writeFileSync(sdkTypesPath, await sdkTypes());
  writeFileSync(sdkModelPath, sdkModel());
  console.log(`Gravados ${sdkTypesPath} e ${sdkModelPath}`);
}
