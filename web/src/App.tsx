import { useCallback, useMemo } from "react";
import { Route, Routes, useSearchParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { FactsProvider } from "./components/FactsPanel";
import { StaleContext } from "./lib/queries";
import { Overview } from "./pages/Overview";
import { Components } from "./pages/Components";
import { NodePage } from "./pages/node/NodePage";
import { WhoUses } from "./pages/WhoUses";
import { Organization } from "./pages/Organization";
import { Sources } from "./pages/Sources";
import { Divergences } from "./pages/Divergences";
import { Referenced } from "./pages/Referenced";
import { Search } from "./pages/Search";
import { NotFound } from "./pages/NotFound";

export default function App() {
  // "Incluir o que sumiu" fica na URL (?stale=1), para o link copiado mostrar o mesmo que a tela.
  const [params, setParams] = useSearchParams();
  const includeStale = params.get("stale") === "1";
  const setIncludeStale = useCallback(
    (v: boolean) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (v) next.set("stale", "1");
          else next.delete("stale");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const stale = useMemo(() => ({ includeStale, setIncludeStale }), [includeStale, setIncludeStale]);

  return (
    <StaleContext.Provider value={stale}>
      <FactsProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/componentes" element={<Components />} />
            <Route path="/n/:key" element={<NodePage />} />
            <Route path="/quem-usa" element={<WhoUses />} />
            <Route path="/organizacao" element={<Organization />} />
            <Route path="/fontes" element={<Sources />} />
            <Route path="/divergencias" element={<Divergences />} />
            <Route path="/referenciados" element={<Referenced />} />
            <Route path="/busca" element={<Search />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </FactsProvider>
    </StaleContext.Provider>
  );
}
