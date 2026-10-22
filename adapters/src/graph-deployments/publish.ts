import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PanoramaGraphClient, PanoramaGraphError } from "@panorama-graph/sdk";
import { ingest } from "../core/api";
import { componentKey } from "../core/keys";
import { PRODUCER } from "../core/producer";
import type { Snapshot } from "../core/snapshot";
import { planPublish } from "../graph-publish/publish";
import { bundleUrl, revisionsToFreeze, type DeploymentsPlan } from "./deployments";

export type FreezeOptions = {
  client: PanoramaGraphClient;
  /** Modelo da URL do pacote de artefatos de um commit, com `{component}` e `{commit}`. Sem ele, nada é congelado. */
  bundleUrlTemplate?: string;
  /** Host do repositório, quando o manifest.json do pacote não traz a URL dele. */
  host?: string;
  observedAt: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
};

/** `refrozen`: commits cujo retrato congelado foi refeito, por ter sido montado por uma versão mais antiga destes adaptadores. */
export type PublishResult = { frozen: string[]; refrozen: string[]; missing: string[]; alreadyFrozen: string[]; failed: boolean };

/** Quem montou um retrato, como o sources_status o devolve (ausente: o produtor não informou). */
type Producer = { name: string; version: string } | undefined;

/**
 * Commits que já têm retrato congelado na API (`component:...@commit`), com quem montou o retrato de cada fonte,
 * segundo o sources_status.
 */
export async function frozenRevisions(client: PanoramaGraphClient): Promise<Map<string, Producer[]>> {
  const status = await client.query("sources_status", { limit: 1 });
  const out = new Map<string, Producer[]>();
  for (const s of status.sources) {
    for (const scope of s.scopes) {
      if (!scope.revision?.frozen) continue;
      const id = `${scope.revision.component}@${scope.revision.commit}`;
      out.set(id, [...(out.get(id) ?? []), scope.producer]);
    }
  }
  return out;
}

/**
 * Por que refazer o retrato congelado, ou null se ele está em dia: algum retrato do commit foi montado por uma versão
 * mais antiga destes adaptadores, ou antes de eles informarem a versão. O que outro produtor montou não conta.
 */
export function staleReason(producers: Producer[]): string | null {
  for (const p of producers) {
    if (!p) return "montado antes de os adaptadores informarem a versão";
    if (p.name === PRODUCER.name && Bun.semver.order(p.version, PRODUCER.version) < 0) return `montado pela versão ${p.version}`;
  }
  return null;
}

/** Baixa e abre o pacote de artefatos (tar.gz de `build/architecture`). null quando não existe. */
async function openBundle(url: string, fetchFn: typeof fetch): Promise<{ dir: string; cleanup: () => void } | null | string> {
  const res = await fetchFn(url);
  if (res.status === 404) return null;
  if (!res.ok) return `o repositório de artefatos respondeu ${res.status}`;
  const dir = mkdtempSync(join(tmpdir(), "graph-deployments-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const file = join(dir, "bundle.tar.gz");
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const out = join(dir, "architecture");
  const tar = Bun.spawnSync(["sh", "-c", `mkdir -p "${out}" && tar -xzf "${file}" -C "${out}"`], { stderr: "pipe" });
  if (tar.exitCode !== 0) {
    cleanup();
    return `pacote ilegível: ${tar.stderr.toString().trim()}`;
  }
  return { dir: out, cleanup };
}

async function send(client: PanoramaGraphClient, snapshot: Snapshot, log: (l: string) => void): Promise<boolean> {
  try {
    const res = await ingest(client, snapshot);
    if (res.status === "outdated") log(`    ${snapshot.source}: a API já tem um retrato mais novo (${res.message})`);
    return true;
  } catch (e) {
    if (!(e instanceof PanoramaGraphError)) throw e;
    log(`    ${snapshot.source}: ${e.message}${e.details ? ` ${JSON.stringify(e.details)}` : ""}`);
    return false;
  }
}

/**
 * Publica as implantações. Primeiro congela o retrato de cada commit em execução que a API ainda não tem (baixa o
 * pacote de artefatos daquele commit e publica como retrato congelado), e refaz o que foi montado por uma versão mais
 * antiga destes adaptadores (que extraía menos do mesmo pacote); depois envia um retrato por ambiente, com os
 * DEPLOYED_IN. Nessa ordem, o recorte de um ambiente já encontra a versão quando a implantação aparece. Commit sem
 * pacote não impede a implantação: ela é publicada, e o recorte daquele componente segue a linha principal.
 */
export async function publishDeployments(plan: DeploymentsPlan, opts: FreezeOptions): Promise<PublishResult> {
  const log = opts.log ?? (() => {});
  const fetchFn = opts.fetch ?? fetch;
  const result: PublishResult = { frozen: [], refrozen: [], missing: [], alreadyFrozen: [], failed: false };

  const known = await frozenRevisions(opts.client);
  for (const r of revisionsToFreeze(plan.deployments)) {
    const id = `${r.component}@${r.commit}`;
    const producers = known.get(`${componentKey(r.component)}@${r.commit}`);
    const reason = producers ? staleReason(producers) : null;
    if (producers && !reason) {
      result.alreadyFrozen.push(id);
      continue;
    }
    // Sem como refazer, o retrato que existe continua valendo.
    const keep = (why: string) => {
      log(`  ${id}: ${why}; fica o retrato ${reason}`);
      result.alreadyFrozen.push(id);
    };
    if (!opts.bundleUrlTemplate) {
      if (reason) keep("sem --bundle-url para refazê-lo");
      else result.missing.push(id);
      continue;
    }
    const url = bundleUrl(opts.bundleUrlTemplate, r.component, r.commit);
    const bundle = await openBundle(url, fetchFn);
    if (bundle === null || typeof bundle === "string") {
      if (reason) keep(`${bundle ?? "sem pacote de artefatos"} (${url})`);
      else {
        log(`  ${id}: ${bundle ?? "sem pacote de artefatos"} (${url}); o recorte segue a linha principal`);
        result.missing.push(id);
      }
      continue;
    }
    try {
      const frozen = planPublish(bundle.dir, opts.observedAt, {
        frozen: true,
        version: r.version,
        env: {},
        overrides: { path: r.component, commit: r.commit, ...(opts.host ? { host: opts.host } : {}) },
      });
      log(`  ${id} (${r.version}): ${reason ? `refazendo (${reason})` : "congelando"} ${frozen.snapshots.length} retrato(s)`);
      let ok = true;
      for (const s of frozen.snapshots) ok = (await send(opts.client, s, log)) && ok;
      if (ok) (reason ? result.refrozen : result.frozen).push(id);
      else result.failed = true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (reason) keep(message);
      else {
        log(`  ${id}: ${message}`);
        result.missing.push(id);
      }
    } finally {
      bundle.cleanup();
    }
  }

  for (const s of plan.snapshots) {
    const n = s.relations.length;
    log(`  ${s.scope.namespace}: ${n} implantação(ões)`);
    if (!(await send(opts.client, s, log))) result.failed = true;
  }
  return result;
}
