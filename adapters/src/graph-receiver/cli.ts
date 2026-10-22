#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { PanoramaGraphClient } from "@panorama-graph/sdk";
import { createReceiver } from "./receiver";

const USAGE = `graph-receiver — recebe os artefatos de arquitetura de um build e publica no panorama-graph-api

Uso: graph-receiver [opções]

  --api <url>          URL do panorama-graph-api (ou GRAPH_API_URL)
  --port <n>           porta (ou RECEIVER_PORT; padrão 3210)
  --max-body-mb <n>    tamanho máximo de um pacote (ou RECEIVER_MAX_BODY_MB; padrão 32)

Rotas: POST /v1/builds (o pacote, no formato panorama-graph-build/1) e GET /health.`;

const { values } = parseArgs({
  options: {
    api: { type: "string" },
    port: { type: "string" },
    "max-body-mb": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const api = values.api ?? process.env.GRAPH_API_URL;
if (!api) {
  console.error("Informe --api ou GRAPH_API_URL.");
  process.exit(1);
}
const port = Number(values.port ?? process.env.RECEIVER_PORT ?? 3210);
const maxBodyMb = Number(values["max-body-mb"] ?? process.env.RECEIVER_MAX_BODY_MB ?? 32);

const handler = createReceiver({
  client: new PanoramaGraphClient({ baseUrl: api }),
  log: (line) => console.log(`${new Date().toISOString()} ${line}`),
});
const server = Bun.serve({ port, maxRequestBodySize: maxBodyMb * 1024 * 1024, fetch: handler });
console.log(`graph-receiver em http://localhost:${server.port}, publicando em ${api}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.stop();
    process.exit(0);
  });
}
