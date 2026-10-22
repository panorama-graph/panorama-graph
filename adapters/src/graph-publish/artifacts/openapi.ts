import { contractKey, endpointKey, httpApiKey, joinPaths, pathVersion } from "../../core/keys";
import { artifactEvidence, builder, type Context, declaredVersion, sourceEvidence } from "./context";

export const SOURCE = "openapi";

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** Acima disto (em caracteres do JSON), o contrato de uma operação vai sem o fecho dos `$ref`, com aviso. */
export const MAX_CONTRACT_CHARS = 64 * 1024;

/** Extensões da especificação (`x-...`), como a `x-panorama-graph-source`. */
type Extensions = { [extension: `x-${string}`]: unknown };

type Operation = { operationId?: string; summary?: string; parameters?: unknown[]; requestBody?: unknown; responses?: unknown } & Extensions;

export type OpenApi = {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string; version?: string } & Extensions;
  basePath?: string;
  paths?: Record<string, Record<string, Operation | unknown>>;
  components?: Record<string, Record<string, unknown>>;
  definitions?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  responses?: Record<string, unknown>;
};

/**
 * A API HTTP que o componente oferece, com as operações e o contrato de cada uma, e o documento OpenAPI (ou Swagger 2)
 * que a especifica. A evidência da API e de cada operação é o ponto do código informado em
 * `x-panorama-graph-source` (em `info`, na operação ou no path item), ou, sem ele, o ponto do artefato. O
 * contrato é o próprio documento: a evidência dele é sempre o artefato.
 *
 * API versionada no código é uma API por versão: a declarada em `x-panorama-graph-version` (na operação, no path
 * item ou em `info`) ou, sem ela, a do primeiro segmento do caminho (`/v1/...`). A operação sem versão fica na API sem
 * versão. A versão exposta na infraestrutura (`servico-xpto-v2`) não está no documento: quem a afirma é a implantação.
 */
export function mapOpenApi(ctx: Context, doc: OpenApi) {
  const b = builder(ctx, SOURCE);
  const file = "openapi.json";
  const contract = contractKey("openapi", ctx.id.service);
  const declared = sourceEvidence(b, SOURCE, doc.info, "", "info");
  b.node(contract, "Contract", { name: `OpenAPI ${ctx.id.service}`, kind: "openapi" }, artifactEvidence(ctx, file));

  const service = ctx.id.service;
  const apiVersion = declaredVersion(b, SOURCE, doc.info, "info");
  const apis = new Set<string>();
  const apiOf = (version?: string) => {
    const api = httpApiKey(service, version);
    if (!apis.has(api)) {
      apis.add(api);
      const name = (doc.info?.title ?? service) + (version ? ` ${version}` : "");
      const props = { name, kind: "http", ...(version ? { version } : {}), ...(doc.info?.description ? { description: doc.info.description } : {}) };
      b.node(api, "Api", props, declared || artifactEvidence(ctx, file, ["info"]));
      b.relation("PROVIDES", ctx.component, api, {}, declared || artifactEvidence(ctx, file));
      b.relation("SPECIFIED_BY", api, contract, {}, artifactEvidence(ctx, file));
    }
    return api;
  };

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    const itemSource = sourceEvidence(b, SOURCE, item, "", path);
    const itemVersion = declaredVersion(b, SOURCE, item, path);
    for (const [method, op] of Object.entries(item ?? {})) {
      if (!METHODS.includes(method)) continue;
      const full = joinPaths(doc.basePath, path);
      const o = (op ?? {}) as Operation;
      const version = declaredVersion(b, SOURCE, o, `${method.toUpperCase()} ${full}`) ?? itemVersion ?? apiVersion ?? pathVersion(full);
      const api = apiOf(version);
      const endpoint = endpointKey(service, method, full, version);
      const pointer = artifactEvidence(ctx, file, ["paths", path, method]);
      const evidence = sourceEvidence(b, SOURCE, o, "", `${method.toUpperCase()} ${full}`) || itemSource || pointer;
      let body = JSON.stringify(operationContract(doc, item as Record<string, unknown>, o));
      if (body.length > MAX_CONTRACT_CHARS) {
        body = JSON.stringify(operationContract(doc, item as Record<string, unknown>, o, { closure: false }));
        b.warn(`openapi: contrato de ${method.toUpperCase()} ${full} passa de ${MAX_CONTRACT_CHARS} caracteres; vai sem o fecho dos $ref (components)`);
      }
      b.node(
        endpoint,
        "Endpoint",
        {
          method: method.toUpperCase(),
          path: full,
          name: `${method.toUpperCase()} ${full}`,
          ...(o.operationId ? { operationId: o.operationId } : {}),
          ...(o.summary ? { description: o.summary } : {}),
          contract: body,
        },
        evidence,
      );
      b.relation("HAS_ENDPOINT", api, endpoint, {}, evidence);
    }
  }
  if (apis.size === 0) apiOf(apiVersion);
  return b;
}

/**
 * Contrato de uma operação, como está no documento: os parâmetros (os do caminho e os da operação), o corpo, as
 * respostas e, com `closure`, o fecho dos `$ref` locais que eles usam, em `components` e agrupados pela seção de
 * origem (`schemas`, `parameters`, `responses`, `requestBodies`...; as `definitions` do Swagger 2 vão para `schemas`).
 * Os `$ref` ficam como estão; o fecho resolve ciclos e repetição.
 */
export function operationContract(doc: OpenApi, pathItem: Record<string, unknown>, op: Operation, opts: { closure?: boolean } = {}) {
  const parameters = [...((pathItem.parameters as unknown[] | undefined) ?? []), ...(op.parameters ?? [])];
  const out: Record<string, unknown> = {
    format: doc.swagger ? "swagger-2" : "openapi-3",
    ...(parameters.length ? { parameters } : {}),
    ...(op.requestBody !== undefined ? { requestBody: op.requestBody } : {}),
    ...(op.responses !== undefined ? { responses: op.responses } : {}),
  };
  if (opts.closure === false) return out;

  const closure: Record<string, Record<string, unknown>> = {};
  const pending = collectRefs([parameters, op.requestBody, op.responses]);
  const seen = new Set<string>();
  while (pending.length) {
    const ref = pending.pop()!;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const target = resolveLocal(doc, ref);
    if (!target) continue;
    (closure[target.section] ??= {})[target.name] = target.value;
    pending.push(...collectRefs([target.value]));
  }
  return Object.keys(closure).length ? { ...out, components: closure } : out;
}

/** `#/components/<seção>/<nome>` (OpenAPI 3) ou `#/<definitions|parameters|responses>/<nome>` (Swagger 2). */
function resolveLocal(doc: OpenApi, ref: string): { section: string; name: string; value: unknown } | undefined {
  const parts = ref.replace(/^#\//, "").split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts[0] === "components" && parts.length === 3) {
    const value = doc.components?.[parts[1]]?.[parts[2]];
    return value === undefined ? undefined : { section: parts[1], name: parts[2], value };
  }
  if (parts.length === 2 && (parts[0] === "definitions" || parts[0] === "parameters" || parts[0] === "responses")) {
    const value = (doc[parts[0]] as Record<string, unknown> | undefined)?.[parts[1]];
    return value === undefined ? undefined : { section: parts[0] === "definitions" ? "schemas" : parts[0], name: parts[1], value };
  }
  return undefined;
}

function collectRefs(values: unknown[]): string[] {
  const refs: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "$ref" && typeof x === "string" && x.startsWith("#/")) refs.push(x);
        else walk(x);
      }
    }
  };
  values.forEach(walk);
  return refs;
}
