#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { PanoramaGraphClient, PanoramaGraphError } from "@panorama-graph/sdk";
import { ingest } from "../core/api";
import { planSeed } from "./seed";

const USAGE = `graph-seed — envia ao panorama-graph-api retratos declarados em arquivos YAML

Uso: graph-seed <diretório> [opções]

  diretório            arquivos *.yaml com a lista "snapshots" (ver README)

  --api <url>          URL do panorama-graph-api (ou GRAPH_API_URL)
  --dry-run            monta os retratos e mostra o resumo, sem enviar
  --print              com --dry-run, imprime os retratos em JSON
  --observed-at <iso>  quando os fatos foram vistos (padrão: agora)

Saída 0: tudo enviado (ou retrato mais antigo que o da API, que não é erro). 1: erro de uso ou de leitura.
2: a API recusou um retrato.`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      api: { type: "string" },
      "dry-run": { type: "boolean" },
      print: { type: "boolean" },
      "observed-at": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }

  const plan = planSeed(positionals[0], values["observed-at"] ?? new Date().toISOString());
  for (const s of plan.snapshots) {
    const scope = Object.entries(s.scope).map(([k, v]) => `${k}=${v}`).join(",");
    console.log(`  ${s.file.padEnd(22)} ${s.source.padEnd(16)} ${scope.padEnd(48)} ${String(s.nodes.length).padStart(4)} nós ${String(s.relations.length).padStart(4)} relações`);
  }
  for (const w of plan.warnings) console.warn(`  aviso: ${w}`);
  if (plan.errors.length > 0) {
    for (const e of plan.errors) console.error(`  erro: ${e}`);
    return 1;
  }

  if (values["dry-run"]) {
    if (values.print) console.log(JSON.stringify(plan.snapshots.map(({ file: _, ...s }) => s), null, 2));
    return 0;
  }

  const url = values.api ?? process.env.GRAPH_API_URL;
  if (!url) {
    console.error("Informe --api ou GRAPH_API_URL (ou use --dry-run).");
    return 1;
  }
  const client = new PanoramaGraphClient({ baseUrl: url });
  await client.assertModel();

  let failed = false;
  for (const { file, ...s } of plan.snapshots) {
    const label = `${s.source} ${JSON.stringify(s.scope)}`;
    try {
      const res = await ingest(client, s);
      if (res.status === "outdated") {
        console.log(`  ${label}: não gravado, a API já tem um retrato mais novo (${res.message})`);
        continue;
      }
      const { nodes, relations, referenced } = res.counts;
      const fmt = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ");
      console.log(`  ${label}: nós (${fmt(nodes)}), relações (${fmt(relations)}), referenciados ${referenced}`);
    } catch (e) {
      failed = true;
      if (e instanceof PanoramaGraphError) {
        console.error(`  ${label} (${file}): ${e.message}`);
        if (e.details) console.error(JSON.stringify(e.details, null, 2));
      } else {
        throw e;
      }
    }
  }
  return failed ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
