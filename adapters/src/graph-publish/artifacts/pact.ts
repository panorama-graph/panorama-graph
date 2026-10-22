import { contractKey, endpointKey, httpApiKey, matchesTemplate, pathVersion, splitServiceVersion } from "../../core/keys";
import { artifactEvidence, builder, type Context } from "./context";
import type { KnownOperation } from "./http-clients";

export const SOURCE = "pact";

export type Pact = {
  consumer: { name: string };
  provider: { name: string };
  interactions?: { type?: string; description?: string; request?: { method?: string; path?: string } }[];
  messages?: unknown[];
};

/**
 * Pacts de consumidor gerados no build do componente: ele consome a API do provedor, e o pact a especifica.
 *
 * O pact tem caminhos concretos (`/products/p-1`). Para virar `CALLS`, cada interação é casada com as
 * operações conhecidas do mesmo provedor (os clientes HTTP do próprio build). Sem operação que case, a
 * interação só conta para o `CONSUMES`, com aviso.
 *
 * Versões: o `CONSUMES` vai para a API da versão do host (o nome do provedor, `product-api-v2`) ou, sem ela, para a de
 * cada versão do caminho das interações (`/v1/...`). O `CALLS` vai para o endpoint do código, só com a versão do caminho.
 */
export function mapPacts(ctx: Context, pacts: { file: string; pact: Pact }[], operations: Map<string, KnownOperation[]>) {
  const b = builder(ctx, SOURCE);
  for (const { file, pact } of pacts) {
    const provider = pact.provider?.name;
    if (!provider) {
      b.warn(`pact: ${file} sem provider.name, ignorado`);
      continue;
    }
    const http = (pact.interactions ?? []).filter((i) => !i.type || /http/i.test(i.type));
    if (http.length === 0) continue; // pact de mensagens: fica para o AsyncAPI

    const contract = contractKey("pact", `${pact.consumer?.name ?? ctx.id.service}→${provider}`);
    const path = `pacts/${file}`;
    b.node(contract, "Contract", { name: `Pact ${pact.consumer?.name ?? ctx.id.service} → ${provider}`, kind: "pact" }, artifactEvidence(ctx, path));
    const host = splitServiceVersion(provider);
    const paths = http.map((it) => it.request?.path).filter((p): p is string => !!p);
    const versions = host.version || paths.length === 0 ? [host.version] : paths.map(pathVersion);
    const apis = new Set(versions.map((v) => httpApiKey(host.service, v)));
    for (const api of apis) {
      b.relation("CONSUMES", ctx.component, api, {}, artifactEvidence(ctx, path));
      b.relation("SPECIFIED_BY", api, contract, {}, artifactEvidence(ctx, path));
    }

    http.forEach((it, i) => {
      const method = (it.request?.method ?? "GET").toUpperCase();
      const concrete = it.request?.path;
      if (!concrete) return;
      const version = pathVersion(concrete);
      const op = (operations.get(host.service) ?? []).find(
        (o) => o.version === version && o.method.toUpperCase() === method && matchesTemplate(concrete, o.path),
      );
      if (!op) {
        b.warn(`pact: ${method} ${concrete} (${provider}) não casa com nenhuma operação dos clientes HTTP; fica só o CONSUMES`);
        return;
      }
      b.relation("CALLS", ctx.component, endpointKey(host.service, method, op.path, version), {}, artifactEvidence(ctx, path, ["interactions", String(i)]));
    });
  }
  return b;
}
