import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useIncludeStale } from "./queries";

/** Caminho interno mantendo o "incluir o que sumiu" (?stale=1) ao navegar. */
export function useTo() {
  const { includeStale } = useIncludeStale();
  return useCallback(
    (path: string) => {
      if (!includeStale) return path;
      return `${path}${path.includes("?") ? "&" : "?"}stale=1`;
    },
    [includeStale],
  );
}

/**
 * Grava vários filtros da URL de uma vez, sem mexer nos outros parâmetros. Para mudar mais de um filtro no mesmo
 * clique, use este: no React Router 6, duas chamadas seguidas ao setter partem dos mesmos parâmetros, e a segunda
 * desfaz a primeira.
 */
export function useSetUrlParams(): (values: Record<string, string>) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (values: Record<string, string>) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          for (const [name, v] of Object.entries(values)) {
            if (v) next.set(name, v);
            else next.delete(name);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
}

/** Um filtro da tela guardado na URL (`?nome=valor`), sem mexer nos outros parâmetros. */
export function useUrlParam(name: string): [string, (v: string) => void] {
  const [params] = useSearchParams();
  const setParams = useSetUrlParams();
  const set = useCallback((v: string) => setParams({ [name]: v }), [name, setParams]);
  return [params.get(name) ?? "", set];
}
