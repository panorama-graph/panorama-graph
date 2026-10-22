import { Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { ContractList } from "@/lib/types";
import { displayName } from "@/lib/nodes";
import { QueryView } from "@/components/QueryView";
import { Section } from "@/components/Section";
import { EdgeList } from "@/components/EdgeList";
import { FactsBadge } from "@/components/FactsBadge";
import { NodeLink } from "@/components/NodeLink";
import { Consumers } from "./ComponentView";
import { NodeHeader, Relations, TabBar, nameOf, useTab } from "./common";

const TABS = [
  { id: "endpoints", label: "Endpoints e contratos" },
  { id: "consumidores", label: "Quem consome" },
  { id: "relacoes", label: "Todas as relações" },
];

/** API: os endpoints com e sem contrato (contract_get), quem consome (api_consumers) e as relações. */
export function ApiView({ nodeKey }: { nodeKey: string }) {
  const [tab, setTab] = useTab(TABS.map((t) => t.id));
  const query = useGraphQuery<ContractList>("contract_get", { target: nodeKey });
  return (
    <QueryView query={query} showQuery={tab === "endpoints"}>
      {(data) => {
        const entry = data.apis.find((a) => a.api.key === data.target) ?? data.apis[0];
        if (!entry) return <Relations nodeKey={nodeKey} header />;
        const name = nameOf(entry.api);
        return (
          <>
            <NodeHeader node={entry.api} />
            <TabBar tabs={TABS} value={tab} onChange={setTab} />
            {tab === "endpoints" && (
              <>
                <Section title="Contratos" count={entry.contracts.length}>
                  <EdgeList edges={entry.contracts} owner={name} empty="Nenhum contrato afirmado." />
                </Section>
                <Section title="Endpoints" count={entry.endpoints.length}>
                  {entry.endpoints.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      Nenhum endpoint afirmado.
                    </Typography>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Endpoint</TableCell>
                          <TableCell>Descrição</TableCell>
                          <TableCell>Contrato</TableCell>
                          <TableCell align="right">Fontes</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {entry.endpoints.map((e) => (
                          <TableRow key={e.node.key} hover>
                            <TableCell>
                              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                <NodeLink node={e.node} />
                                {e.operationId && (
                                  <Typography variant="caption" color="text.secondary">
                                    {e.operationId}
                                  </Typography>
                                )}
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ color: "text.secondary" }}>{e.description ?? "—"}</TableCell>
                            <TableCell>
                              <Chip size="small" label={e.hasContract ? "tem contrato" : "sem contrato"} color={e.hasContract ? "default" : "warning"} variant="outlined" />
                            </TableCell>
                            <TableCell align="right">
                              <FactsBadge facts={e.facts} title={`${name} tem ${displayName(e.node)}`} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Section>
              </>
            )}
            {tab === "consumidores" && <Consumers target={entry.api.key} />}
            {tab === "relacoes" && <Relations nodeKey={entry.api.key} />}
          </>
        );
      }}
    </QueryView>
  );
}
