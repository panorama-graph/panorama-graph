import { createContext, useContext } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { QueryName } from "@panorama-graph/sdk";
import { runQuery } from "./api";

/**
 * Argumentos que cada ferramenta aceita além dos próprios. As rotas recusam argumento a mais (400), então só vai
 * `includeStale` e `detail` para quem os declara.
 */
const TOOL_OPTS: Partial<Record<QueryName, { stale: boolean; detail: boolean }>> = {
  architecture_overview: { stale: true, detail: true },
  component_get: { stale: true, detail: true },
  components_list: { stale: true, detail: true },
  api_consumers: { stale: true, detail: true },
  contract_get: { stale: true, detail: true },
  component_dependencies: { stale: true, detail: true },
  topic_get: { stale: true, detail: true },
  dataset_get: { stale: true, detail: true },
  org_structure: { stale: true, detail: true },
  library_usage: { stale: true, detail: true },
  component_libraries: { stale: true, detail: true },
  route_get: { stale: true, detail: true },
  nodes_find: { stale: true, detail: false },
  node_get: { stale: true, detail: true },
  component_compare: { stale: false, detail: false },
  sources_status: { stale: false, detail: false },
  fact_divergences: { stale: false, detail: true },
};

/** "Incluir o que sumiu": afirmações e nós stale, em todas as telas. */
export const StaleContext = createContext<{ includeStale: boolean; setIncludeStale: (v: boolean) => void }>({
  includeStale: false,
  setIncludeStale: () => {},
});

export const useIncludeStale = () => useContext(StaleContext);

/** Os argumentos que a tela manda, já com `detail: "full"` e o `includeStale` da tela, quando a ferramenta aceita. */
export function toolArgs(tool: QueryName, args: Record<string, unknown>, includeStale: boolean): Record<string, unknown> {
  const opts = TOOL_OPTS[tool] ?? { stale: false, detail: false };
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== ""));
  return {
    ...clean,
    ...(opts.detail ? { detail: "full" } : {}),
    ...(opts.stale && includeStale ? { includeStale: true } : {}),
  };
}

/** Uma consulta do grafo. `enabled: false` segura a chamada até os argumentos estarem completos. */
export function useGraphQuery<T>(tool: QueryName, args: Record<string, unknown>, opts: { enabled?: boolean } = {}) {
  const { includeStale } = useIncludeStale();
  const sent = toolArgs(tool, args, includeStale);
  const query = useQuery<T, Error>({
    queryKey: [tool, sent],
    queryFn: () => runQuery<T>(tool, sent),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: (count, err) => count < 1 && !("status" in err && (err as { status: number }).status >= 400),
  });
  return { ...query, tool, sent };
}
