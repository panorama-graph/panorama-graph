import { contractKey, topicKey, topicVersion } from "../../core/keys";
import { artifactEvidence, builder, type Context, declaredVersion, sourceEvidence } from "./context";

export const SOURCE = "asyncapi";

type Ref = { $ref?: string };
export type AsyncApi = {
  asyncapi?: string;
  info?: { title?: string };
  channels?: Record<string, { address?: string | null; publish?: unknown; subscribe?: unknown } & Record<string, unknown>>;
  operations?: Record<string, { action?: "send" | "receive"; channel?: Ref } & { [extension: `x-${string}`]: unknown }>;
};

/**
 * Tópicos que o componente publica e consome, e o documento AsyncAPI que os especifica.
 *
 * AsyncAPI 3: `send` é publicar, `receive` é consumir. AsyncAPI 2 descreve a operação do ponto de vista de
 * quem usa a aplicação: `subscribe` (o cliente assina) é a aplicação publicando, e `publish` é ela consumindo.
 * Um endereço com placeholder não resolvido (`${...}`) fica de fora, com aviso. A versão do tópico é a declarada no
 * canal (`x-panorama-graph-version`) ou, sem ela, a do fim do nome (`product-created-v1`, `product-created.v1`).
 *
 * A evidência do tópico é o ponto do código informado em `x-panorama-graph-source` no canal; a de publicar e
 * consumir, o da operação (sem ele, o do canal). Sem a extensão, o ponto do artefato. O contrato é o próprio
 * documento: a evidência do `SPECIFIED_BY` é sempre o artefato.
 */
export function mapAsyncApi(ctx: Context, doc: AsyncApi) {
  const b = builder(ctx, SOURCE);
  const file = "asyncapi.json";
  const contract = contractKey("asyncapi", ctx.id.service);
  const flows: { relation: "PUBLISHES" | "SUBSCRIBES"; channel: string; pointer: string[]; operation: unknown }[] = [];

  if (doc.asyncapi?.startsWith("2.")) {
    for (const [name, ch] of Object.entries(doc.channels ?? {})) {
      if (ch.subscribe) flows.push({ relation: "PUBLISHES", channel: name, pointer: ["channels", name, "subscribe"], operation: ch.subscribe });
      if (ch.publish) flows.push({ relation: "SUBSCRIBES", channel: name, pointer: ["channels", name, "publish"], operation: ch.publish });
    }
  } else {
    for (const [id, op] of Object.entries(doc.operations ?? {})) {
      const ref = op.channel?.$ref?.replace(/^#\/channels\//, "");
      if (!ref || !op.action) continue;
      flows.push({ relation: op.action === "send" ? "PUBLISHES" : "SUBSCRIBES", channel: decodePointer(ref), pointer: ["operations", id], operation: op });
    }
  }

  for (const f of flows) {
    const address = doc.asyncapi?.startsWith("2.") ? f.channel : (doc.channels?.[f.channel]?.address ?? f.channel);
    if (!address || address.includes("${")) {
      b.warn(`asyncapi: canal "${f.channel}" sem endereço resolvido, ignorado`);
      continue;
    }
    const topic = topicKey(address);
    const channelSource = sourceEvidence(b, SOURCE, doc.channels?.[f.channel], "", `canal "${f.channel}"`);
    const evidence = sourceEvidence(b, SOURCE, f.operation, "", f.pointer.join("/")) || channelSource || artifactEvidence(ctx, file, f.pointer);
    const version = declaredVersion(b, SOURCE, doc.channels?.[f.channel], `canal "${f.channel}"`) ?? topicVersion(address);
    b.node(topic, "Topic", { name: address, ...(version ? { version } : {}) }, channelSource || artifactEvidence(ctx, file, ["channels", f.channel]));
    b.relation(f.relation, ctx.component, topic, {}, evidence);
    b.relation("SPECIFIED_BY", topic, contract, {}, artifactEvidence(ctx, file, ["channels", f.channel]));
  }

  if (!b.isEmpty) b.node(contract, "Contract", { name: `AsyncAPI ${ctx.id.service}`, kind: "asyncapi" }, artifactEvidence(ctx, file));
  return b;
}

function decodePointer(p: string): string {
  return p.replace(/~1/g, "/").replace(/~0/g, "~");
}
