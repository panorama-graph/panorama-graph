#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { PanoramaGraphClient, PanoramaGraphError } from "@panorama-graph/sdk";
import { ingest } from "../core/api";
import { planPublish } from "./publish";
import { outcomeLine, planLines } from "./report";

const USAGE = `graph-publish — publica no panorama-graph-api a arquitetura gerada no build de um componente

Uso: graph-publish [diretório] [opções]

  diretório            artefatos de arquitetura do build (padrão: build/architecture)

  --api <url>          URL do panorama-graph-api (ou GRAPH_API_URL)
  --dry-run            monta os retratos e mostra o resumo, sem enviar
  --print              com --dry-run, imprime os retratos em JSON
  --component <path>   caminho do repositório (padrão: CI_PROJECT_PATH, GITHUB_REPOSITORY ou o manifest.json)
  --host <host>        host do repositório (padrão: CI_SERVER_HOST, GITHUB_SERVER_URL ou o manifest.json)
  --commit <sha>       commit (padrão: CI_COMMIT_SHA, GITHUB_SHA ou o manifest.json)
  --service <nome>     nome do serviço para os clientes (padrão: application.json ou o fim do caminho)
  --kind <kind>        kind do Component: service, bff, frontend, job, library (padrão: service)
  --evidence-dir <p>   caminho do diretório de artefatos a partir da raiz do repositório (padrão: build/architecture)
  --observed-at <iso>  quando o build viu os fatos (padrão: agora)
  --version <v>        versão do artefato (padrão: a do manifest.json)
  --revision           retrato congelado do commit (escopo com o commit), e não o da linha principal: só aparece
                       no recorte de um ambiente em que o commit está implantado. Usado pelo graph-deployments

Saída 0: tudo publicado (ou retrato mais antigo que o da API, que não é erro). 1: erro de uso ou de leitura.
2: a API recusou um retrato.`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      api: { type: "string" },
      "dry-run": { type: "boolean" },
      print: { type: "boolean" },
      component: { type: "string" },
      host: { type: "string" },
      commit: { type: "string" },
      service: { type: "string" },
      kind: { type: "string" },
      "evidence-dir": { type: "string" },
      "observed-at": { type: "string" },
      version: { type: "string" },
      revision: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const dir = positionals[0] ?? "build/architecture";
  const observedAt = values["observed-at"] ?? new Date().toISOString();
  const plan = planPublish(dir, observedAt, {
    overrides: { path: values.component, host: values.host, commit: values.commit, service: values.service },
    kind: values.kind,
    artifactsDir: values["evidence-dir"],
    version: values.version,
    frozen: values.revision,
  });

  for (const line of planLines(plan, values.revision)) console.log(line);
  for (const w of plan.warnings) console.warn(`  aviso: ${w}`);

  if (values["dry-run"]) {
    if (values.print) console.log(JSON.stringify(plan.snapshots, null, 2));
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
  for (const s of plan.snapshots) {
    try {
      console.log(outcomeLine(s.source, await ingest(client, s)));
    } catch (e) {
      failed = true;
      if (e instanceof PanoramaGraphError) {
        console.error(`  ${s.source}: ${e.message}`);
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
