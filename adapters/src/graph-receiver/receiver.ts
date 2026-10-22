import { type PanoramaGraphClient, PanoramaGraphError } from "@panorama-graph/sdk";
import { ingest, type IngestOutcome } from "../core/api";
import { isBundlePath, mapFiles } from "../graph-publish/bundle";
import { planPublish, type Plan } from "../graph-publish/publish";
import { outcomeLine, planLines } from "../graph-publish/report";

/** Formato do corpo do `POST /v1/builds` (especificado em `schemas/build.schema.json`). */
export const BUILD_FORMAT = "panorama-graph-build/1";

export type BuildRequest = {
  format?: string;
  /** Os arquivos de `build/architecture`, por caminho relativo, com o conteúdo JSON de cada um. */
  files: Record<string, unknown>;
  options?: {
    kind?: string;
    version?: string;
    evidenceDir?: string;
    observedAt?: string;
    component?: string;
    host?: string;
    commit?: string;
    service?: string;
  };
  /** Monta e confere os retratos, sem gravar. */
  dryRun?: boolean;
};

type SnapshotResult = {
  source: string;
  nodes: number;
  relations: number;
  result: "planned" | "ok" | "outdated" | "rejected";
  counts?: Extract<IngestOutcome, { status: "ok" }>["counts"];
  message?: string;
  details?: unknown;
};

export type BuildResponse = {
  status: "planned" | "published" | "rejected";
  identity: Plan["identity"];
  snapshots: SnapshotResult[];
  skipped: string[];
  warnings: string[];
  /** O mesmo resumo, em linhas, que o graph-publish mostra; é o que vai no `text/plain`. */
  report: string[];
};

export type ReceiverOptions = {
  client: PanoramaGraphClient;
  log?: (line: string) => void;
  now?: () => Date;
};

/** Erro no formato único do produto: `{ error, code, status, details }`. */
function error(status: number, code: string, message: string, details?: unknown, text = false): Response {
  if (text) return new Response(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
  return Response.json({ error: message, code, status, ...(details !== undefined ? { details } : {}) }, { status });
}

/**
 * O graph-receiver: recebe os artefatos de arquitetura de um build e publica no grafo, como o graph-publish faria no
 * pipeline. A tradução é a mesma (`planPublish`); a identidade vem só do manifesto e das opções do pedido, nunca do
 * ambiente do receptor.
 */
export function createReceiver(opts: ReceiverOptions): (req: Request) => Promise<Response> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());

  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health" && req.method === "GET") return Response.json({ status: "ok" });
    if (url.pathname !== "/v1/builds") return error(404, "not_found", `Rota ${req.method} ${url.pathname} não existe`);
    if (req.method !== "POST") return error(405, "method_not_allowed", "Use POST /v1/builds");
    const text = (req.headers.get("accept") ?? "").includes("text/plain");

    let body: BuildRequest;
    try {
      body = (await req.json()) as BuildRequest;
    } catch {
      return error(400, "invalid_build", "O corpo não é JSON", undefined, text);
    }
    const invalid = validate(body);
    if (invalid) return error(400, "invalid_build", invalid, undefined, text);

    const o = body.options ?? {};
    let plan: Plan;
    try {
      plan = planPublish(mapFiles(body.files), o.observedAt ?? now().toISOString(), {
        env: {},
        overrides: { path: o.component, host: o.host, commit: o.commit, service: o.service },
        kind: o.kind,
        version: o.version,
        artifactsDir: o.evidenceDir,
      });
    } catch (e) {
      return error(400, "invalid_build", e instanceof Error ? e.message : String(e), undefined, text);
    }

    const report = planLines(plan);
    const snapshots: SnapshotResult[] = plan.snapshots.map((s) => ({ source: s.source, nodes: s.nodes.length, relations: s.relations.length, result: "planned" }));
    let status: BuildResponse["status"] = "planned";

    if (!body.dryRun) {
      try {
        await opts.client.assertModel();
      } catch (e) {
        log(`${plan.identity.path}: grafo indisponível (${e instanceof Error ? e.message : String(e)})`);
        return error(502, "graph_unavailable", `O panorama-graph-api não respondeu: ${e instanceof Error ? e.message : String(e)}`, undefined, text);
      }
      status = "published";
      for (const [i, s] of plan.snapshots.entries()) {
        try {
          const outcome = await ingest(opts.client, s);
          snapshots[i] = { ...snapshots[i], result: outcome.status, ...(outcome.status === "ok" ? { counts: outcome.counts } : { message: outcome.message }) };
          report.push(outcomeLine(s.source, outcome));
        } catch (e) {
          if (!(e instanceof PanoramaGraphError)) {
            log(`${plan.identity.path}: grafo indisponível no meio da carga (${e instanceof Error ? e.message : String(e)})`);
            return error(502, "graph_unavailable", `O panorama-graph-api parou de responder no retrato ${s.source}: ${e instanceof Error ? e.message : String(e)}`, undefined, text);
          }
          status = "rejected";
          snapshots[i] = { ...snapshots[i], result: "rejected", message: e.message, ...(e.details ? { details: e.details } : {}) };
          report.push(`  ${s.source}: recusado: ${e.message}`);
          if (e.details) report.push(...JSON.stringify(e.details, null, 2).split("\n").map((l) => `    ${l}`));
        }
      }
    }
    report.push(...plan.warnings.map((w) => `  aviso: ${w}`));

    const id = plan.identity;
    log(`${id.path} @ ${id.commit.slice(0, 12)}: ${status} (${plan.snapshots.length} retrato(s))`);
    const res: BuildResponse = { status, identity: id, snapshots, skipped: plan.skipped, warnings: plan.warnings, report };
    const code = status === "rejected" ? 422 : 200;
    if (text) return new Response(`${report.join("\n")}\n`, { status: code, headers: { "content-type": "text/plain; charset=utf-8" } });
    return Response.json(code === 422 ? { error: "O grafo recusou retrato(s) do build", code: "snapshot_rejected", status: code, details: res } : res, { status: code });
  };
}

function validate(body: BuildRequest): string | undefined {
  if (!body || typeof body !== "object") return "O corpo deve ser um objeto";
  if (body.format !== undefined && body.format !== BUILD_FORMAT) {
    return `formato ${JSON.stringify(body.format)} desconhecido; este graph-receiver lê ${BUILD_FORMAT}`;
  }
  if (!body.files || typeof body.files !== "object" || Array.isArray(body.files)) return "files deve ser um objeto: caminho → conteúdo";
  const bad = Object.keys(body.files).filter((p) => !isBundlePath(p));
  if (bad.length) return `caminhos de arquivo inválidos (relativos, sem '..', terminados em .json): ${bad.join(", ")}`;
  if (!("manifest.json" in body.files)) return "falta o manifest.json";
  return undefined;
}
