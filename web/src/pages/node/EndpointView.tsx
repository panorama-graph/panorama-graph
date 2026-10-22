import { Box, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { ContractOne, NodeGet } from "@/lib/types";
import { QueryView } from "@/components/QueryView";
import { Section } from "@/components/Section";
import { EdgeList } from "@/components/EdgeList";
import { Coverage } from "@/components/Coverage";
import { Consumers } from "./ComponentView";
import { NodeHeader, Relations, TabBar, nameOf, useTab } from "./common";

const TABS = [
  { id: "contrato", label: "Contrato" },
  { id: "consumidores", label: "Quem chama" },
  { id: "relacoes", label: "Todas as relações" },
];

/**
 * Endpoint: o contrato da operação (contract_get com endpoint) e quem o chama (api_consumers com endpoint). As
 * duas pedem a API, que vem do node_get (HAS_ENDPOINT).
 */
export function EndpointView({ nodeKey }: { nodeKey: string }) {
  const [tab, setTab] = useTab(TABS.map((t) => t.id));
  const query = useGraphQuery<NodeGet>("node_get", { node: nodeKey });
  return (
    <QueryView query={query} showQuery={false}>
      {(data) => {
        const api = data.relations.find((g) => g.type === "HAS_ENDPOINT" && g.direction === "in")?.edges[0]?.node.key;
        return (
          <>
            <NodeHeader node={data.node} />
            <TabBar tabs={TABS} value={tab} onChange={setTab} />
            {!api && tab !== "relacoes" && <Coverage notes={["Nenhuma fonte afirma a que API este endpoint pertence."]} />}
            {api && tab === "contrato" && <Contract api={api} endpoint={data.node.key} />}
            {api && tab === "consumidores" && <Consumers target={api} endpoint={data.node.key} />}
            {tab === "relacoes" && <Relations nodeKey={data.node.key} />}
          </>
        );
      }}
    </QueryView>
  );
}

function Contract({ api, endpoint }: { api: string; endpoint: string }) {
  const query = useGraphQuery<ContractOne>("contract_get", { target: api, endpoint });
  return (
    <QueryView query={query}>
      {(data) => (
        <>
          <Section title="API">
            <EdgeList edges={data.apis} owner={nameOf(data.endpoint)} showType />
          </Section>
          <Section title="Contrato da operação">
            <Coverage notes={[data.coverage?.contract?.note]} />
            {data.contract && (
              <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: "grey.50", borderRadius: 1, fontSize: 12, overflow: "auto", maxHeight: 600 }}>
                {JSON.stringify(data.contract, null, 2)}
              </Box>
            )}
            <Typography variant="caption" color="text.secondary">
              Contrato do último build publicado, não necessariamente o que está em execução.
            </Typography>
          </Section>
        </>
      )}
    </QueryView>
  );
}
