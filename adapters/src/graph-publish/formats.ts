/**
 * Formatos dos artefatos que o produto define (os demais, como OpenAPI, AsyncAPI, CycloneDX e Pact, são padrões
 * de fora). A especificação de cada um está em `schemas/<artefato>.schema.json`.
 */
export const FORMATS = {
  manifest: { file: "manifest.json", current: "panorama-graph-manifest/1" },
  application: { file: "application.json", current: "panorama-graph-application/1" },
  httpClients: { file: "http-clients.json", current: "panorama-graph-http-clients/2" },
  dataAccess: { file: "data-access.json", current: "panorama-graph-data-access/2" },
} as const;

export type ArtifactFormat = keyof typeof FORMATS;

/**
 * Confere o `format` declarado no artefato. Ausente é lido como o atual, com aviso; qualquer outro nome (outro
 * formato ou versão que este graph-publish não entende) é erro, para não publicar fatos de um artefato lido errado.
 */
export function checkFormat(artifact: ArtifactFormat, doc: { format?: unknown } | undefined): string | undefined {
  const spec = FORMATS[artifact];
  const format = doc?.format;
  if (format === spec.current) return undefined;
  if (format === undefined) return `${spec.file}: sem format; lido como ${spec.current}`;
  throw new Error(`${spec.file}: formato ${JSON.stringify(format)} desconhecido; este graph-publish lê ${spec.current}`);
}
