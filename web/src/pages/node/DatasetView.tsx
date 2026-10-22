import { Chip, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { DatasetGet } from "@/lib/types";
import { QueryView } from "@/components/QueryView";
import { Section } from "@/components/Section";
import { EdgeList } from "@/components/EdgeList";
import { STORE_LABEL } from "@/lib/nodes";
import { NodeHeader, nameOf } from "./common";

/** Dataset: a categoria do banco, o dono da estrutura, quem lê e quem escreve, com a linha do código como evidência (dataset_get). */
export function DatasetView({ nodeKey }: { nodeKey: string }) {
  const query = useGraphQuery<DatasetGet>("dataset_get", { dataset: nodeKey });
  return (
    <QueryView query={query}>
      {(data) => {
        const name = nameOf(data.dataset);
        const store = data.dataset.props.store as string | undefined;
        return (
          <>
            <NodeHeader
              node={data.dataset}
              extra={store && <Chip size="small" variant="outlined" label={STORE_LABEL[store] ?? store} title="Categoria do banco (store)" />}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              O dataset é identificado pelo componente que o mapeia: dois serviços na mesma coleção física aparecem como datasets distintos.
            </Typography>
            <Section title="Dono da estrutura" count={data.owners.length}>
              <EdgeList edges={data.owners} owner={name} empty="Nenhum dono afirmado." />
            </Section>
            <Section title="Leem" count={data.readers.length}>
              <EdgeList edges={data.readers} owner={name} empty="Nenhuma leitura afirmada." />
            </Section>
            <Section title="Escrevem" count={data.writers.length}>
              <EdgeList edges={data.writers} owner={name} empty="Nenhuma escrita afirmada." />
            </Section>
          </>
        );
      }}
    </QueryView>
  );
}
