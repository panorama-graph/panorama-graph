import { type PanoramaGraphClient, PanoramaGraphError, type IngestResult } from "@panorama-graph/sdk";
import type { Snapshot } from "./snapshot";

export type IngestOutcome =
  | { status: "ok"; counts: IngestResult["counts"] }
  /** A API já tem um retrato mais novo do mesmo escopo: este não é gravado, e não é erro. */
  | { status: "outdated"; message: string };

/** Carga de um retrato pelo cliente do SDK, com o retrato desatualizado como resultado, e não como erro. */
export async function ingest(client: PanoramaGraphClient, snapshot: Snapshot): Promise<IngestOutcome> {
  try {
    return { status: "ok", counts: (await client.ingest(snapshot)).counts };
  } catch (e) {
    if (e instanceof PanoramaGraphError && e.code === "outdated_snapshot") return { status: "outdated", message: e.message };
    throw e;
  }
}
