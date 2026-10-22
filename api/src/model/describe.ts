import { KEY_FORMAT } from "./keys";
import {
  FACT_STATES,
  FACT_STATUSES,
  MODEL_VERSION,
  NODE_TYPES,
  NODE_TYPE_NAMES,
  PROVENANCE_FIELDS,
  RELATION_TYPE_NAMES,
  nodeProps,
  relationSpec,
} from "./model";

/** O modelo como documento: o que o GET /schema devolve aos adaptadores e consumidores. */
export function describeModel() {
  return {
    modelVersion: MODEL_VERSION,
    keyFormat: KEY_FORMAT,
    nodeTypes: NODE_TYPE_NAMES.map((type) => ({
      type,
      prefix: NODE_TYPES[type].prefix,
      description: NODE_TYPES[type].description,
      props: nodeProps(type),
    })),
    relationTypes: RELATION_TYPE_NAMES.map((type) => {
      const spec = relationSpec(type);
      return {
        type,
        description: spec.description,
        nature: spec.nature,
        pairs: spec.pairs.map(([from, to]) => ({ from, to })),
        props: spec.props,
        identityProps: spec.identityProps,
      };
    }),
    provenance: {
      fields: PROVENANCE_FIELDS,
      states: FACT_STATES,
      statuses: FACT_STATUSES,
      rules: [
        "Todo fato leva source, evidence, state, observedAt e loadId. Fato sem evidência é recusado.",
        "Uma afirmação por source e escopo: fontes diferentes geram relações paralelas.",
        "Carga por retrato: o que a mesma source e escopo deixaram de afirmar vira stale, e continua consultável.",
        "POST /ingest grava só observed.",
      ],
    },
  };
}
