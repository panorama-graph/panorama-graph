/**
 * Snapshot do OpenAPI do REST: `contract/openapi-v<N>.json` é o documento servido em `GET /v<N>/openapi.json`, no
 * repositório para quem gera cliente sem subir a API (e, depois, para o SDK).
 *
 *   bun run openapi:write   grava o snapshot a partir das rotas atuais
 *
 * O teste `rest.test.ts` falha quando as rotas mudam e o snapshot não.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { buildApp } from "../src/app";
import { API_PREFIX } from "../src/api/rest";
import type { GraphDb } from "../src/db/neo4j";

export const openApiPath = join(import.meta.dir, "..", "contract", `openapi-${API_PREFIX.slice(1)}.json`);

/** O OpenAPI que o código serve hoje (monta as rotas sem banco: nenhuma consulta roda). */
export async function currentOpenApi(): Promise<object> {
  const app = await buildApp({ db: {} as GraphDb, logger: pino({ level: "silent" }) });
  await app.ready();
  const doc = app.swagger();
  await app.close();
  return doc;
}

if (import.meta.main) {
  writeFileSync(openApiPath, `${JSON.stringify(await currentOpenApi(), null, 2)}\n`);
  console.log(`Gravado ${openApiPath}`);
}
