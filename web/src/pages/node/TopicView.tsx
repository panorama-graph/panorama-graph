import { Stack, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { TopicGet } from "@/lib/types";
import { QueryView } from "@/components/QueryView";
import { Section } from "@/components/Section";
import { EdgeList } from "@/components/EdgeList";
import { channelWords } from "@/lib/nodes";
import { NodeLink } from "@/components/NodeLink";
import { NodeHeader, nameOf } from "./common";

/** Tópico ou fila: as versões do mesmo tópico, quem publica (envia), quem assina (consome), o contrato e o broker (topic_get). */
export function TopicView({ nodeKey }: { nodeKey: string }) {
  const query = useGraphQuery<TopicGet>("topic_get", { topic: nodeKey });
  return (
    <QueryView query={query}>
      {(data) => {
        const name = nameOf(data.topic);
        const words = channelWords(data.topic.props.kind);
        return (
          <>
            <NodeHeader node={data.topic} />
            {data.versions.length > 1 && (
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Versões do {words.noun}:
                </Typography>
                {data.versions.map((v) => (
                  <NodeLink key={v.key} node={{ key: v.key, name: v.version ?? "sem versão", type: "Topic" }} />
                ))}
              </Stack>
            )}
            <Section title={words.publishers} count={data.publishers.length}>
              <EdgeList edges={data.publishers} owner={name} empty="Nenhum publicador afirmado." />
            </Section>
            <Section title={words.subscribers} count={data.subscribers.length}>
              <EdgeList edges={data.subscribers} owner={name} empty="Nenhum assinante afirmado." />
            </Section>
            <Section title="Contrato">
              <EdgeList edges={data.contracts} owner={name} empty="Nenhum contrato afirmado." />
            </Section>
            <Section title="Broker">
              <EdgeList edges={data.hostedOn} owner={name} empty="Nenhum broker afirmado." />
            </Section>
          </>
        );
      }}
    </QueryView>
  );
}
