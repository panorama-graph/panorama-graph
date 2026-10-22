import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "@panorama-graph/sdk";
import { checkSnapshot } from "./check";
import { type DirectoryExport, directorySnapshot } from "./directory";
import { type InfraInventory, infraSnapshots } from "./infra";

/** Lê os exports do diretório e monta os retratos, com os erros de tradução e de conferência contra o modelo. */
export function plan(dir: string, observedAt: string): { snapshots: Snapshot[]; errors: string[] } {
  const snapshots: Snapshot[] = [];
  const errors: string[] = [];
  const directory = join(dir, "directory.json");
  if (existsSync(directory)) {
    const res = directorySnapshot(JSON.parse(readFileSync(directory, "utf8")) as DirectoryExport, observedAt);
    snapshots.push(res.snapshot);
    errors.push(...res.errors.map((e) => `directory.json: ${e}`));
  }
  const infra = join(dir, "infra.yaml");
  if (existsSync(infra)) {
    const res = infraSnapshots(Bun.YAML.parse(readFileSync(infra, "utf8")) as InfraInventory, observedAt);
    snapshots.push(...res.snapshots);
    errors.push(...res.errors.map((e) => `infra.yaml: ${e}`));
  }
  if (snapshots.length === 0) errors.push(`${dir}: nem directory.json nem infra.yaml`);
  errors.push(...snapshots.flatMap(checkSnapshot));
  return { snapshots, errors };
}
