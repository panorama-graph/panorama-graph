/**
 * Snapshot do contrato das consultas: `contract/queries-v<N>.json` é o contrato como publicado na versão N.
 *
 *   bun run contract:write   grava o snapshot da versão atual, se a mudança respeita CONTRACT_POLICY
 *
 * O teste `contract.test.ts` falha quando as ferramentas mudam e o snapshot não: toda mudança no contrato passa
 * por aqui, e uma incompatível só passa com QUERY_CONTRACT_VERSION novo (e o que sai, obsoleto antes).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphDb } from "../src/db/neo4j";
import type { QueryService } from "../src/query/QueryService";
import { QUERY_CONTRACT_VERSION, incompatibilities, queryContract, type QueryContract } from "../src/query/contract";
import { queryTools } from "../src/query/tools";

const DIR = join(import.meta.dir, "..", "contract");

export const snapshotPath = (version: number) => join(DIR, `queries-v${version}.json`);

export function readSnapshot(version: number): QueryContract | null {
  const path = snapshotPath(version);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as QueryContract) : null;
}

/** O contrato que o código serve hoje (só os metadados: nenhuma consulta roda). */
export const currentContract = () => queryContract(queryTools({} as QueryService, {} as GraphDb));

if (import.meta.main) {
  const current = currentContract();
  const published = readSnapshot(QUERY_CONTRACT_VERSION) ?? readSnapshot(QUERY_CONTRACT_VERSION - 1);
  const problems = published ? incompatibilities(published, current) : [];
  if (problems.length > 0) {
    console.error(`Mudança incompatível com a versão ${published!.version} do contrato das consultas:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Suba QUERY_CONTRACT_VERSION (src/query/contract.ts) e deixe a forma antiga obsoleta por uma versão.");
    process.exit(1);
  }
  writeFileSync(snapshotPath(QUERY_CONTRACT_VERSION), `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Gravado ${snapshotPath(QUERY_CONTRACT_VERSION)}`);
}
