import { endpointKey, httpApiKey, normalizeInterfaceVersion, pathVersion, splitServiceVersion } from "../../core/keys";
import { artifactEvidence, builder, type Context } from "./context";

export const SOURCE = "http-clients";

/**
 * `http-clients.json`: os clientes HTTP declarativos do componente, gerados no build. Formato
 * `panorama-graph-http-clients/2` (`schemas/http-clients.schema.json`):
 * `{ clients: [{ group, service, version, type, source, baseUrlProperty, operations: [{ method, path, function }] }] }`.
 * `group` é o nome do destino na infraestrutura; `service` é o serviço, sem a versão que vai no host
 * (`product-catalog-api-v1` → `product-catalog-api`). Artefatos sem `service` usam `group`.
 */
export type HttpClients = {
  format?: string;
  clients: {
    group: string;
    service?: string;
    version?: string;
    type?: string;
    source?: string;
    baseUrlProperty?: string;
    operations: { method: string; path: string; version?: string; function?: string }[];
  }[];
};

type Client = HttpClients["clients"][number];
type Operation = Client["operations"][number];

/** Serviço e versão do host: `service` e `version` do artefato, ou, sem `service`, a convenção no `group` (`product-api-v2`). */
function hostOf(client: Client): { service: string; version?: string } {
  if (!client.service) return splitServiceVersion(client.group);
  const version = normalizeInterfaceVersion(client.version);
  return version ? { service: client.service, version } : { service: client.service };
}

/** Versão da operação no código: a declarada (`version` da operação) ou a do primeiro segmento do caminho. */
const codeVersion = (op: Operation) => normalizeInterfaceVersion(op.version) ?? pathVersion(op.path);

/**
 * Quem o componente chama, e quais operações, pelos clientes declarados no código. A evidência é o arquivo do
 * cliente que o gerador informa (`source`, com a função de cada operação); sem ele, o ponto do artefato.
 *
 * Versões: o `CONSUMES` vai para a API da versão do host (`product-api-v2` → `api:product-api/v2/http`) ou, sem ela,
 * para a de cada versão do código que o cliente chama. O `CALLS` vai para o endpoint do código, só com a versão do
 * código: o serviço exposto com a versão no host serve as operações do código.
 */
export function mapHttpClients(ctx: Context, doc: HttpClients) {
  const b = builder(ctx, SOURCE);
  (doc.clients ?? []).forEach((client, i) => {
    const pointer = (...path: string[]) => artifactEvidence(ctx, "http-clients.json", ["clients", String(i), ...path]);
    const host = hostOf(client);
    const operations = client.operations ?? [];
    const versions = host.version || operations.length === 0 ? [host.version] : operations.map(codeVersion);
    for (const api of new Set(versions.map((v) => httpApiKey(host.service, v)))) b.relation("CONSUMES", ctx.component, api, {}, client.source ?? pointer());
    operations.forEach((op, j) => {
      const evidence = client.source ? client.source + (op.function ? `#${op.function}` : "") : pointer("operations", String(j));
      b.relation("CALLS", ctx.component, endpointKey(host.service, op.method, op.path, codeVersion(op)), {}, evidence);
    });
  });
  return b;
}

export type KnownOperation = { method: string; path: string; version?: string };

/** Operações conhecidas por serviço de destino (sem a versão do host), com a versão do código, para casar os pacts. */
export function operationsByService(doc: HttpClients | undefined): Map<string, KnownOperation[]> {
  const out = new Map<string, KnownOperation[]>();
  for (const c of doc?.clients ?? []) {
    const { service } = hostOf(c);
    const known = c.operations.map((op) => {
      const version = codeVersion(op);
      return { method: op.method, path: op.path, ...(version ? { version } : {}) };
    });
    out.set(service, [...(out.get(service) ?? []), ...known]);
  }
  return out;
}
