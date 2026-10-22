import type { Snapshot as IngestSnapshot } from "@panorama-graph/sdk";
import { PRODUCER } from "./producer";

/**
 * Retrato no formato do `POST /v1/ingest` (o `Snapshot` do SDK): tudo o que uma fonte viu num escopo, aqui sempre com
 * escopo, nós e relações. Fatos da mesma fonte e escopo que não vierem no próximo retrato viram `stale` na API.
 */
export type Snapshot = IngestSnapshot & Required<Pick<IngestSnapshot, "scope" | "nodes" | "relations">>;

export type NodeFact = Snapshot["nodes"][number];
export type RelationFact = Snapshot["relations"][number];

export type Props = Record<string, string | number | boolean | string[]>;

/**
 * Monta um retrato sem repetições: o mesmo nó ou a mesma relação (tipo, de, para e identidade) afirmados duas vezes
 * ficam uma vez, com a primeira evidência. As propriedades das repetições completam as da primeira.
 */
export class SnapshotBuilder {
  private readonly nodes = new Map<string, NodeFact>();
  private readonly relations = new Map<string, RelationFact>();
  readonly warnings: string[] = [];

  constructor(
    private readonly source: string,
    private readonly scope: Record<string, string>,
    private readonly evidenceBase?: string,
  ) {}

  node(key: string, type: string, props: Props = {}, evidence?: string): this {
    const existing = this.nodes.get(key);
    if (existing) {
      existing.props = { ...clean(props), ...existing.props };
    } else {
      this.nodes.set(key, { key, type, props: clean(props), ...(evidence ? { evidence } : {}) });
    }
    return this;
  }

  /** `identity`: o que distingue duas afirmações entre os mesmos nós (as propriedades de identidade da relação). */
  relation(type: string, from: string, to: string, props: Props = {}, evidence?: string, identity: string[] = []): this {
    const id = JSON.stringify([type, from, to, ...identity]);
    const existing = this.relations.get(id);
    if (existing) {
      existing.props = { ...clean(props), ...existing.props };
    } else {
      this.relations.set(id, { type, from, to, props: clean(props), ...(evidence ? { evidence } : {}) });
    }
    return this;
  }

  hasNode(key: string): boolean {
    return this.nodes.has(key);
  }

  warn(message: string): this {
    this.warnings.push(message);
    return this;
  }

  get isEmpty(): boolean {
    return this.nodes.size === 0 && this.relations.size === 0;
  }

  build(observedAt: string): Snapshot {
    return {
      source: this.source,
      scope: this.scope,
      observedAt,
      ...(this.evidenceBase ? { evidenceBase: this.evidenceBase } : {}),
      producer: { ...PRODUCER },
      nodes: [...this.nodes.values()],
      relations: [...this.relations.values()],
    };
  }
}

function clean(props: Props): Props {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined && v !== "")) as Props;
}
