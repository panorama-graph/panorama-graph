import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GraphDb } from "../db/neo4j";
import { ApiError, apiErrorBody } from "../errors";
import type { QueryService } from "../query/QueryService";
import { QUERY_CONTRACT_VERSION } from "../query/contract";
import { PROVENANCE_NOTE, queryTools, runQueryTool, toolDescription, type QueryTool } from "../query/tools";

const INSTRUCTIONS =
  "Grafo da arquitetura e da estrutura organizacional. Responde quem chama quem, quem é dono, stack, bancos, " +
  "eventos e rotas. Por onde começar: pergunta aberta (\"qual a arquitetura?\") → architecture_overview sem " +
  "parâmetros; \"o que está em volta de X?\" → architecture_overview com component (e depth); \"quais frontends " +
  "(ou bffs, jobs) dependem de X?\" → component_dependencies com direction in, kind e depth 2 ou 3, para passar " +
  "por intermediários; \"quem chama a API de X e quais endpoints?\" → api_consumers; um componente em detalhe → " +
  "component_get (inclui `data`: as coleções e tabelas que ele mapeia, lê e escreve); \"qual é o contrato da API " +
  "de X ou do endpoint Y (parâmetros, corpo, respostas, schemas)?\" → contract_get; \"quem lê ou escreve a " +
  "coleção X?\" → dataset_get; \"quem são as pessoas e em que times estão?\" → people_list; \"onde X roda e em que " +
  "versão?\" → component_get (`deployments`); \"quais bibliotecas X usa e em que versão?\" → component_libraries; " +
  "\"quem usa a biblioteca L (ou a versão 2.x dela) e por qual dependência ela chega?\" → library_usage, que também aceita " +
  "o componente que gera bibliotecas (\"quem usa o framework F?\": todos os pacotes dele); " +
  "\"o que mudou entre o código e produção?\" → component_compare; graph_query só para " +
  "explorar o que nenhuma ferramenta cobre (não é contrato: a forma interna do grafo pode mudar). " +
  "APIs e tópicos versionados são um nó por versão, com `version` (v1, v2): \"quem consome a v1 da API de X?\" → " +
  "api_consumers com a API daquela versão (allVersions: de todas); \"quem assina a v2 do evento Y?\" → topic_get " +
  "com o tópico daquela versão (com o nome sem a versão, ou allVersions: todas, cada assinante com a versão). " +
  "Nós são identificados por chave `<prefixo>:<id>` (ex.: component:example/catalog/product-api); " +
  "as ferramentas também aceitam apelido, nome ou o último segmento da chave, e devolvem os candidatos quando há " +
  `ambiguidade. ${PROVENANCE_NOTE} Por padrão só vem o retrato atual; includeStale traz o que a fonte deixou de afirmar. ` +
  "O retrato padrão é o da linha principal (o código mais recente publicado); para perguntas sobre o que roda num " +
  "ambiente (ex.: impacto em produção), passe `environment`: os componentes implantados nele aparecem na versão em " +
  "execução, com `version` na ponta de cada um. " +
  "Resposta vazia com `coverage` quer dizer que nenhuma fonte publica aquele tipo de fato: diga que não há dados, não que não existe.";

/**
 * Servidor MCP de consulta. Um por requisição (transporte sem sessão). Todas as ferramentas são só de leitura e
 * são as mesmas do REST (`POST /queries/<nome>`), definidas em `query/tools.ts`. Cada uma traz no `_meta` a
 * versão do contrato das consultas, a versão em que entrou, se é estável e, quando obsoleta, a substituta.
 */
export function createMcpServer(queries: QueryService, db: GraphDb): McpServer {
  const server = new McpServer({ name: "panorama-graph", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const annotations = { readOnlyHint: true, openWorldHint: false };
  for (const tool of queryTools(queries, db)) {
    server.registerTool(
      tool.name,
      { description: toolDescription(tool), inputSchema: tool.inputSchema, annotations, _meta: contractMeta(tool) },
      (args: Record<string, unknown>) => run(tool, args),
    );
  }
  return server;
}

export const CONTRACT_META_KEY = "panorama-graph/contract";

function contractMeta(tool: QueryTool) {
  return {
    [CONTRACT_META_KEY]: {
      version: QUERY_CONTRACT_VERSION,
      since: tool.since ?? 1,
      stability: tool.stability ?? "stable",
      ...(tool.deprecated ? { deprecated: tool.deprecated } : {}),
      ...(tool.deprecatedArgs ? { deprecatedArgs: tool.deprecatedArgs } : {}),
    },
  };
}

/**
 * Resultado em JSON compacto (quem lê é o modelo), com as afirmações resumidas em `summary`.
 * Erro de domínio volta como isError, no formato único dos erros (o mesmo corpo do REST).
 */
async function run(tool: QueryTool, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await runQueryTool(tool, args)) }] };
  } catch (err) {
    if (err instanceof ApiError) return { isError: true, content: [{ type: "text", text: JSON.stringify(apiErrorBody(err)) }] };
    throw err;
  }
}
