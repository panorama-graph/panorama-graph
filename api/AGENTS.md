# panorama-graph-api — Guia para agentes

Este arquivo diz **como trabalhar** na API. As regras do repositório inteiro estão no [AGENTS.md da raiz](../AGENTS.md). **Por que o produto existe e o que ele não deve virar** está no [PROPOSITO.md](PROPOSITO.md). O modelo está no [MODELO.md](MODELO.md), as regras de proveniência no [PROVENIENCIA.md](PROVENIENCIA.md) e o que vem pela frente no [ROADMAP.md](../ROADMAP.md).

## Antes de qualquer tarefa

1. **Leia o [PROPOSITO.md](PROPOSITO.md):** as perguntas que o grafo existe para responder, os pilares, o que ele não é e as inspirações. Nenhuma implementação pode contradizê-lo sem revisar o propósito com uma pessoa.
2. **Funcionalidade nova?** Passe pelo [teste de foco](PROPOSITO.md#teste-de-foco). Um "não" pede para reformular ou abandonar a proposta.
3. **Mudança estrutural?** Leia o [ROADMAP.md](../ROADMAP.md) e atualize-o na mesma entrega quando concluir um item ou mudar o rumo dele.

## Regras

- **Produto à parte.** Não depende de nenhum consumidor nem do ACME Bank. Nada específico de uma organização entra no código: o ACME Bank é só dado.
- **Base e API, sem carga.** Leitura de fontes (GitLab, Pact, SBOM, Kubernetes...) é adaptador, em [adapters/](../adapters/AGENTS.md). Aqui só se guarda, valida e serve fatos.
- **As regras de [proveniência e ciclo de vida](PROVENIENCIA.md) são contrato.** Fato sem `source`, `evidence`, `state` e `observedAt` é recusado; `inferred` nunca derruba `observed`; só uma pessoa confirma.
- **O modelo é fechado.** Um tipo de nó ou de relação novo é uma mudança versionada do modelo e nunca algo aceito de um adaptador. A mudança passa por `src/model/model.ts`, sobe `MODEL_VERSION`, regera o [MODELO.md](MODELO.md) (`bun run modelo:write`, a referência para quem adota), com a versão registrada na tabela de versões do modelo, na mesma entrega.
- **Tipos no Cypher só pelo modelo.** Labels e tipos de relação são interpolados no Cypher (sem APOC), o que só é seguro porque vêm da lista fechada de `model.ts`. Nunca interpole texto vindo do payload.
- **Código fora do grafo.** Só ponteiros `repo@sha:caminho:linha` como evidência.
- **Consulta sempre com os fatos.** Toda relação devolvida por uma ferramenta traz as afirmações (`facts`) com a proveniência, uma por fonte e escopo. Nunca colapse fontes nem esconda a divergência para deixar a resposta mais leve. `stale` só vem com `includeStale`.
- **Toda consulta respeita o retrato.** O padrão é a linha principal; com `environment`, as versões implantadas no ambiente (`src/query/view.ts`). Cypher novo de consulta filtra afirmações com `live(...)` e nós com `liveNode(..., vis)`, sempre com `visParams(vis)`: sem isso, um retrato congelado vaza para a visão padrão. Contagens e divergências da linha principal excluem `revision IS NOT NULL`.
- **Consulta só lê.** As ferramentas de consulta rodam em transação de leitura, pelo MCP e pelo REST (`/v1/queries`). Escrita pelo MCP, quando vier, será só a proposta de fato do adaptador agêntico (`fact_propose`), sempre `inferred`.
- **Uma definição por consulta.** Cada consulta é declarada uma vez em `src/query/tools.ts` e servida igual pelo MCP e pelo `POST /v1/queries/<nome>`: mesmo nome, argumentos e resposta. Nunca crie uma consulta só numa das portas. O console ([panorama-graph-web](../web/AGENTS.md)) lê só por essa porta: o que a tela precisa e nenhuma ferramenta responde vira ferramenta nova aqui, servida também ao MCP.

- **O contrato das consultas tem versão.** Nome de ferramenta, argumentos e campos das respostas só mudam de forma compatível na mesma versão (ferramenta nova, argumento opcional, campo novo). O resto é versão nova (`QUERY_CONTRACT_VERSION`), com a forma antiga obsoleta (`deprecated`) por uma versão. Toda mudança nas ferramentas termina com `bun run contract:write`, que grava `contract/queries-v<N>.json` e recusa a incompatível. A política está no README.
- **O REST tem versão no caminho e um formato de erro.** Rota nova entra em `/v1` (registrada em `restApi`, `src/api/rest.ts`), nunca na raiz. Todo erro sai de `ApiError` (com o `code` específico, quando houver) no formato único `{ error, code, status, details }`, igual no REST e no MCP: não monte corpo de erro à mão. Mudança de rota termina com `bun run openapi:write`. Rota nova tem o corpo e a resposta com nome no OpenAPI (`src/api/openapi.ts`), e um teste recusa rota sem tipo.
- **Toda resposta tem forma declarada.** A resposta de cada consulta fica no `output` da ferramenta (`src/query/responses.ts`), e a das demais rotas em `src/api/schemas.ts`. Os esquemas não validam em produção: `test/responses.test.ts` confere as respostas reais contra eles, e um campo novo na resposta entra no esquema na mesma entrega.
- **O SDK sai do contrato.** `../sdks/typescript/src/generated/` é gerado (`bun run sdk:generate`) e nunca editado à mão; mudança no OpenAPI ou no modelo termina com o SDK gerado de novo e, se ele mudou, a versão nova em `../sdks/typescript/package.json`, com os adaptadores e o console ajustados no mesmo commit. Receita de chave nova ou mudada entra em `../sdks/typescript/src/keys.ts`.

## Código

| Caminho | Papel |
|---|---|
| `src/main.ts` | Subida: lê o env, cria o driver, escuta a porta, desliga limpo. |
| `src/app.ts` | `buildApp({ db, logger })`: monta o Fastify sem abrir porta (os testes usam `inject()`). |
| `src/config/` | `env.ts` (zod, sai com erro se inválido) e `logger.ts` (pino). |
| `src/db/neo4j.ts` | `GraphDb`: driver único, `read`/`write` no database configurado, `writeTx` (várias consultas numa transação), `ping` sem retentativa, `serverInfo`. |
| `src/db/constraints.ts` | Restrições e índices, criados na subida ou na primeira escrita. |
| `src/model/` | O modelo (`model.ts`, versão em `MODEL_VERSION`), o formato das chaves (`keys.ts`) e a descrição devolvida pelo `GET /v1/schema` (`describe.ts`). |
| `src/ingest/` | `payload.ts` valida o retrato contra o modelo (tudo ou nada), com a revisão (`revision`) e a regra do retrato congelado. `IngestService.ts` grava a carga por retrato numa transação. `RetentionService.ts` apaga os retratos congelados que saíram dos ambientes e o histórico de deploys vencido. |
| `src/graph/` | `resolve.ts` resolve chave ou apelido para a chave canônica. `NodeService.ts` cuida de apelidos e da união de nós. |
| `src/query/` | Consultas de leitura. `tools.ts` declara as ferramentas (nome, descrição, argumentos, execução e `detail` padrão), usadas pelo MCP e pelo REST. `QueryService.ts` tem uma consulta por ferramenta. `view.ts` é o retrato que cada consulta enxerga (linha principal ou o recorte de um ambiente, com os retratos congelados das versões implantadas): todo Cypher filtra as afirmações com `live` e os nós com `liveNode`, com os parâmetros de `visParams`. `facts.ts` monta a proveniência (`Fact`, `Edge`). `resolveRef.ts` resolve chave, apelido ou nome. `versions.ts` trata as faixas de versão. `graphQuery.ts` é o Cypher só de leitura. `contract.ts` tem a versão e a política do contrato das consultas e a regra de compatibilidade. |
| `src/mcp/` | Servidor MCP (`server.ts`, que registra as ferramentas de `query/tools.ts`) e a rota `POST /mcp` (`route.ts`), por Streamable HTTP sem sessão. |
| `src/api/` | Rotas REST: saúde e, em `/v1` (`rest.ts`), `/schema`, `/ingest`, `/nodes` e `/queries` (o contrato e as consultas, com CORS só para `CORS_ORIGINS`). O OpenAPI fica em `/v1/openapi.json`. |
| `src/errors.ts` | `ApiError(status, mensagem, detalhes, código)`, os códigos estáveis (`ErrorCode`) e o formato único do erro (`errorBody`), usado pelo REST e pelo MCP. |
| `contract/`, `scripts/` | Snapshots do contrato das consultas por versão (`contract.ts`, `bun run contract:write`) e do OpenAPI do REST (`openapi.ts`, `bun run openapi:write`), o gerador do SDK (`sdk.ts`, `bun run sdk:generate`) e as tabelas do MODELO.md (`modelo.ts`, `bun run modelo:write`). |
| `test/` | Testes (`bun test`). `setup.ts` é carregado antes de todos. |

## Como o grafo guarda os fatos

- **Nós do modelo** usam os labels `:Node:<Tipo>` e têm `key` única. As propriedades seguem a regra "a última carga vence".
- **Afirmação de existência de um nó:** `(:Claim {source, scopeKey, evidence, state, status, firstObservedAt, observedAt, loadId})-[:CLAIMS]->(:Node)`. Há uma por source e escopo. Um nó sem claim é referenciado: alguma relação apontou para ele, mas nenhuma fonte o declarou.
- **Afirmação de relação:** uma relação Neo4j por source e escopo, com a proveniência nas propriedades. Duas fontes geram relações paralelas. A identidade de uma afirmação é `(de, tipo, para, source, scopeKey, identityProps do tipo)`.
- **Metadados** ficam em `:Alias`, `:Scope` (trava e último `observedAt` por source e escopo), `:Load` (uma por carga, com as contagens) e `:Merge` (auditoria). Consultas sobre a arquitetura partem de `:Node` e ignoram esses metadados.

## Testes

- Rodam contra o Neo4j de teste (`bun run test:db:up`, porta 7688, dados em memória). `test/setup.ts` recusa rodar se a URI de teste apontar para a porta do banco de desenvolvimento, porque os testes apagam o banco.
- Sem mocks do Neo4j: consultas Cypher são testadas contra o banco real.
- `test/fixtures/acme.ts` é um grafo pequeno no formato do ACME Bank, carregado pelo REST como os adaptadores fariam. Os testes das consultas respondem sobre ele às perguntas de validação do [README](README.md#testes).
- `bun run lint` (tsc) e `bun test` precisam passar antes de entregar.
