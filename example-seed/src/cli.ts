#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { PanoramaGraphClient, PanoramaGraphError } from "@panorama-graph/sdk";
import { plan } from "./plan";

const USAGE = `example-seed — publica no panorama-graph a organização (times e pessoas) e a infraestrutura (ambientes,
servidores, bancos e rotas) a partir dos exports da organização

Uso: example-seed <diretório> [opções]

  diretório            directory.json (export do diretório) e infra.yaml (inventário da infraestrutura); cada
                       um é opcional, e o que faltar não é enviado

  --api <url>          URL do panorama-graph-api (ou GRAPH_API_URL)
  --dry-run            monta e confere os retratos contra o modelo, sem enviar
  --print              com --dry-run, imprime os retratos em JSON
  --observed-at <iso>  quando os fatos foram vistos (padrão: agora)

Saída 0: tudo enviado (ou retrato mais antigo que o da API, que não é erro). 1: erro de uso, de leitura ou de
conferência. 2: a API recusou um retrato.`;

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

  const { snapshots, errors } = plan(positionals[0], values["observed-at"] ?? new Date().toISOString());
  for (const s of snapshots) {
    const scope = Object.entries(s.scope ?? {}).map(([k, v]) => `${k}=${v}`).join(",");
    console.log(`  ${s.source.padEnd(12)} ${scope.padEnd(36)} ${String(s.nodes?.length ?? 0).padStart(4)} nós ${String(s.relations?.length ?? 0).padStart(4)} relações`);
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`  erro: ${e}`);
    return 1;
  }
  if (values["dry-run"]) {
    if (values.print) console.log(JSON.stringify(snapshots, null, 2));
    return 0;
  }

  const url = values.api ?? process.env.GRAPH_API_URL;
  if (!url) {
    console.error("Informe --api ou GRAPH_API_URL (ou use --dry-run).");
    return 1;
  }
  const graph = new PanoramaGraphClient({ baseUrl: url });
  await graph.assertModel(); // a API está no modelo deste SDK?

  let failed = false;
  for (const s of snapshots) {
    const label = `${s.source} ${JSON.stringify(s.scope)}`;
    try {
      const { counts } = await graph.ingest(s);
      const fmt = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ");
      console.log(`  ${label}: nós (${fmt(counts.nodes)}), relações (${fmt(counts.relations)}), referenciados ${counts.referenced}`);
    } catch (e) {
      if (!(e instanceof PanoramaGraphError)) throw e;
      if (e.code === "outdated_snapshot") {
        // A API já tem um retrato mais novo deste escopo: este não é gravado, e não é erro.
        console.log(`  ${label}: não gravado, a API já tem um retrato mais novo`);
        continue;
      }
      failed = true;
      console.error(`  ${label}: ${e.message}`);
      if (e.details) console.error(JSON.stringify(e.details, null, 2));
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
