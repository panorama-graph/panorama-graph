# panorama-graph-api

Base em grafo da arquitetura e da estrutura organizacional, com API para registrar e consultar componentes, times, relacionamentos e stack. Toda resposta diz de onde veio cada fato (fonte, evidência, data).

É a base e a API: modelo, registro com proveniência e consulta. As cargas são adaptadores à parte.

- [PROPOSITO.md](PROPOSITO.md): por que existe, o que o diferencia, o que não é, e as ferramentas de mercado que o inspiraram.
- [ROADMAP.md](../ROADMAP.md): o que já existe e o que vem pela frente.
- [PROVENIENCIA.md](PROVENIENCIA.md): as regras de proveniência e ciclo de vida dos fatos.

## Stack

TypeScript com Node.js (tsx), Fastify, Neo4j Community 5.x.

## Subir

A instância (Neo4j, API e console) sobe pelo compose da raiz; a carga de exemplo, pelo do repositório dos adaptadores: ver os [primeiros passos](../PRIMEIROS-PASSOS.md).

Para desenvolver fora do container, com o Neo4j da raiz (`docker compose up -d neo4j` em `..`):

```sh
cp .env.example .env
pnpm install
pnpm run dev
```

| Serviço | Porta |
|---|---|
| API | `3200` |
| Neo4j Browser | `7474` (usuário e senha do `.env`) |
| Neo4j bolt | `7687` |
| Neo4j de teste (`docker-compose.yml` deste repositório, `pnpm run test:db:up`) | `7688` |

## Saúde

- `GET /health`: o processo responde (não toca no banco).
- `GET /health/ready`: o Neo4j responde. Devolve versão e edição; `503` se o banco estiver indisponível.

## REST: versão, OpenAPI e erros

- **Versão no caminho:** as rotas do REST ficam em `/v1` (`/v1/schema`, `/v1/ingest`, `/v1/queries/...`). Saúde (`/health`) e MCP (`/mcp`, com versão de protocolo própria) ficam fora. A versão segue a política do contrato das consultas: mudança compatível fica no `/v1`; quebra é `/v2`, com o `/v1` servido por um tempo.
- **OpenAPI** em `GET /v1/openapi.json`, também em produção, e no repositório em `contract/openapi-v1.json` (para gerar cliente sem subir a API). Um teste falha quando as rotas mudam e o arquivo não; para atualizá-lo, `pnpm run openapi:write`. Fora de produção, a tela do Swagger fica em `/docs`. Corpos e respostas são tipados, cada um com nome em `components.schemas`: os argumentos e a resposta de cada consulta (`ComponentGetArgs`, `ComponentGetResult`...), as formas compartilhadas (`Fact`, `Edge`, `NodeView`...), o retrato da carga (`Snapshot`) e as respostas das demais rotas. Os esquemas documentam, e não validam: a resposta sai como a API a monta, e os testes conferem cada uma contra o esquema, sem campo a mais nem a menos.
- **Erros num formato único**, no REST e no MCP (o texto de um resultado com `isError`):

```json
{ "error": "\"pagamentos\" é ambíguo: informe a chave de um dos candidatos", "code": "ambiguous", "status": 409,
  "details": { "candidates": [{ "key": "domain:pagamentos", "name": "Pagamentos" }, { "key": "group:pagamentos", "name": "Pagamentos" }] } }
```

| `code` | Status | Quando |
|---|---|---|
| `invalid_request` | 400 | Corpo ou parâmetro fora do esquema (`details.validation`) ou JSON malformado |
| `not_found` | 404 | Nó, escopo ou rota que não existe |
| `unknown_tool` | 404 | Ferramenta fora do contrato das consultas (`details.contractVersion`) |
| `ambiguous` | 409 | O nome casa com mais de um nó (`details.candidates`) |
| `outdated_snapshot` | 409 | Retrato mais antigo que o último do mesmo escopo |
| `conflict` | 409 | Outro conflito (ex.: apelido que já é de outro nó) |
| `invalid_snapshot` | 422 | Carga fora do modelo ou sem evidência (`details.errors`) |
| `unprocessable` | 422 | Pedido bem formado que o domínio recusa (ex.: escrita no `graph_query`, faixa de versão inválida) |
| `forbidden`, `payload_too_large`, `unsupported_media_type`, `internal` | 403, 413, 415, 500 | |

O cliente decide pelo `code`, não pela mensagem. Um código novo é mudança compatível; renomear ou remover um é versão nova.

## Ingestão

O modelo (tipos de nó e de relação, pares válidos, formato das chaves) está em `GET /v1/schema` e, para leitura, no [MODELO.md](MODELO.md), com o que é fixo, o que é livre e como o modelo muda. Para escrever um adaptador sem o SDK (o ciclo de uma carga, as receitas de chave e um exemplo de cada relação), veja o [ADAPTADOR.md](ADAPTADOR.md).

| Endpoint | O que faz |
|---|---|
| `POST /v1/ingest` | Carga por retrato de uma `source` e um `scope`. Grava o que a fonte viu e marca como `stale` o que ela deixou de afirmar no mesmo escopo. |
| `POST /v1/scopes/retire` | Aposenta um escopo em todas as fontes: para o que deixou de existir e cujas fontes não vão mais publicar (ex.: componente removido, com o repositório excluído). Cada fonte que carregou no escopo recebe o equivalente a um retrato vazio, e o que ela afirmava vira `stale`. Grava quem aposentou, o motivo e a evidência. |
| `POST /v1/nodes/{key}/aliases` | Registra um apelido (chave URL-encoded). Cargas com o apelido caem no nó canônico. |
| `POST /v1/nodes/merge` | Une dois nós do mesmo tipo: move as afirmações, o nó que some vira apelido, e a união é registrada. |

```json
POST /v1/ingest
{
  "source": "pact-broker",
  "scope": { "participant": "checkout-api" },
  "observedAt": "2026-09-29T10:00:00Z",
  "evidenceBase": "https://pact-broker.example.com/pacts/provider/product-api/consumer/checkout-api",
  "nodes": [],
  "relations": [
    { "type": "CONSUMES", "from": "component:example/checkout/checkout-api", "to": "api:product-api/http" },
    { "type": "CALLS", "from": "component:example/checkout/checkout-api", "to": "endpoint:product-api/GET /products/{}",
      "evidence": "#interaction-1" }
  ]
}
```

- A evidência de cada fato é a sua `evidence` concatenada à `evidenceBase`, ou só uma delas. Fato sem nenhuma recusa a carga.
- A resposta traz contagens de nós e relações `created`, `updated`, `unchanged` e `stale`, e quantos nós `referenced` foram criados. Um nó referenciado é uma ponta de relação que ainda não existia. Ele fica sem afirmação até uma fonte declará-lo.
- `400` (`invalid_request`) indica payload malformado, `422` (`invalid_snapshot`) indica fato fora do modelo ou sem evidência, com a lista em `details.errors`, e `409` (`outdated_snapshot`) indica retrato mais antigo que o último do mesmo escopo.

```json
POST /v1/scopes/retire
{
  "scope": { "component": "example/catalog/legacy-api" },
  "observedAt": "2026-10-06T15:40:00Z",
  "retiredBy": "portal-interno",
  "reason": "componente removido pelo portal",
  "evidence": "https://portal.example.com/operations/f3061cc3-..."
}
```

- A resposta traz, por fonte, o `loadId` e quantos nós e relações viraram `stale`. Uma transação só: todas as fontes do escopo ou nenhuma.
- Cada fonte ganha uma carga (`:Load`) com `retiredBy`, `reason` e `evidence`. O histórico continua consultável com `includeStale`, e uma carga nova de qualquer fonte no escopo volta a valer.
- `404`: nenhuma fonte carregou o escopo. `409`: `observedAt` anterior à última carga de alguma fonte do escopo.

### Versões: linha principal e retrato congelado

Um retrato pode dizer de que versão de um componente ele é, com `revision`:

```json
{ "source": "openapi", "scope": { "component": "example/catalog/product-api" },
  "revision": { "component": "component:example/catalog/product-api", "commit": "4f2a9c1", "version": "1.5.0" }, ... }
```

- **Linha principal:** escopo sem `commit`. É o retrato padrão das consultas, como sempre; a revisão só registra de que commit e versão ele é (`component_get.revision`).
- **Retrato congelado:** escopo com `commit` (igual ao `revision.commit`). Guarda o que aquela versão oferecia e usava. Não muda as propriedades dos nós nem a vigência deles, que seguem a linha principal, e só aparece no recorte de um ambiente em que o commit está implantado (`DEPLOYED_IN` com o mesmo `commit`). Quem congela é quem vê o commit rodando (o adaptador de implantações), não o pipeline.
- **Retenção:** o retrato congelado fica enquanto o commit está implantado em algum ambiente e mais `FROZEN_RETENTION_DAYS` (30) depois de sair de todos (ou de ser carregado, se nunca entrou). As implantações que saíram (`DEPLOYED_IN` stale) são o histórico de deploys e ficam `DEPLOY_HISTORY_DAYS` (30), ou `DEPLOY_HISTORY_DAYS_PRODUCTION` (365) em ambiente `production`. A limpeza roda a cada `RETENTION_INTERVAL_MINUTES` (60; 0 desliga). A linha principal nunca é apagada.

## Consulta (MCP)

As consultas são ferramentas MCP em `POST /mcp` (Streamable HTTP, sem sessão, respostas em JSON). Para usar no Claude Code:

```sh
claude mcp add --transport http panorama-graph http://localhost:3200/mcp
```

| Ferramenta | Responde |
|---|---|
| `architecture_overview` | Retrato da arquitetura numa chamada: componentes (dono, sistema e o domínio dele, stack, APIs com a contagem de endpoints e os contratos, recursos com o tipo, a instância em que estão e o componente de infraestrutura dela, contagem de bibliotecas), dependências entre componentes (o endpoint chamado com o método e o caminho), quem usa as bibliotecas que um componente do grafo gera (`libraryLinks`, com o pacote e a versão; as de terceiros ficam de fora), tópicos com quem publica, quem assina e o broker em que estão, nós por tipo, fontes carregadas e o que nenhuma fonte cobre (`gaps`). Recortes: `domain` ou `team`, ou `component` com `depth` para a vizinhança técnica (quem ele usa e quem o usa, com o nível de cada um) |
| `component_get` | Componente com dono, sistema e domínio, repositório, stack, APIs oferecidas com os endpoints, `packages` (os pacotes que ele gera, num framework ou biblioteca interna), gateways, recursos até o motor e a versão, `data` (os datasets que ele mapeia, lê e escreve), `revision` (de que commit e versão é a linha principal) e `deployments` (onde roda, em que versão, desde quando, se é o commit da linha principal e se o grafo tem o retrato daquela versão) |
| `component_compare` | O que mudou num componente entre dois retratos (`from` e `to`: ambientes ou, omitidos, a linha principal): endpoints, APIs consumidas, endpoints chamados, tópicos, datasets, recursos, bibliotecas diretas e stack que entraram, saíram ou mudaram de versão (ou de contrato) |
| `components_list` | Componentes com o dono, filtrados por domínio, time (inclui subgrupos), `kind` e tecnologia (da stack ou do banco usado) |
| `api_consumers` | Quem consome uma API (CONSUMES) e quais endpoints chama (CALLS), a partir da API ou do componente que a oferece. Pedida uma API, `versions` lista as versões dela; com `allVersions`, os consumidores de todas |
| `contract_get` | O contrato de uma API: sem `endpoint`, os endpoints e se cada um tem contrato; com `endpoint`, os parâmetros, o corpo, as respostas e os schemas (`components`) da operação, com a evidência no OpenAPI |
| `component_dependencies` | De que um componente depende e quem depende dele, por API, endpoint e tópico, até 5 níveis. Com `kind`, só os componentes daquele tipo, cada um com os caminhos até o componente ("quais frontends dependem de X": `direction: in`, `kind: frontend`, `depth: 3`) |
| `topic_get` | Quem publica e quem assina um tópico, o contrato e o broker. `versions` lista as versões do mesmo tópico; com `allVersions`, ou pelo nome sem a versão, as relações de todas, cada uma com a versão |
| `dataset_get` | Um dataset (coleção ou tabela): o componente dono da estrutura, quem lê e quem escreve, com a linha do código como evidência |
| `org_structure` | Árvore de grupos, membros e o que cada grupo possui |
| `people_list` | Pessoas, em ordem de nome, com os grupos de que fazem parte (papel e `lead` em cada afirmação). Filtros: `group` (membros diretos) e `text` |
| `library_usage` | Quem usa uma biblioteca e em que versão, com filtro de faixa (`<3.2.0`, `>=2.0 <3.0`) e de uso direto (`direct`); cada uso transitivo traz `via` (as dependências diretas que o trazem), e `versions` resume as versões em uso. Aceita o componente que gera bibliotecas (um framework interno de vários módulos): valem os pacotes que ele gera (`packages`, de `PRODUCES`), cada uso com o pacote; consultada a biblioteca, `producedBy` diz de que componente ela sai |
| `component_libraries` | As bibliotecas de um componente com a versão em uso: as diretas por padrão, as transitivas com `transitive` (com `via`), e as declaradas que o código não usa (`unused`) |
| `route_get` | Por onde passa uma requisição para um host (e caminho): gateway ou ingress, e o componente de destino |
| `nodes_find` | Nós de qualquer tipo pelo texto no nome, na chave ou num apelido (busca por texto, não por significado). Com `referencedOnly`, só os nós que nenhuma fonte declarou |
| `node_get` | Qualquer nó com as afirmações de existência e todas as relações, agrupadas por tipo e direção (até 100 por grupo, com o total) |
| `sources_status` | De onde vêm os fatos: por fonte, os escopos com o último retrato (contagens, aposentadoria e, quando o produtor informa, quem o montou e em que versão: `producer`), as cargas recentes e quais fontes publicam cada tipo de fato |
| `fact_divergences` | Onde as fontes discordam: a mesma relação com valores diferentes (`props`) ou relação de alvo único (dono, sistema, repositório) com mais de um alvo (`targets`) |
| `graph_query` | Cypher só de leitura, para explorar o que nenhuma outra cobre. A forma interna do grafo (labels, propriedades, `:Claim`) não é contrato: um sistema que consulta o grafo usa as outras ferramentas, e o que nenhuma responde vira ferramenta nova |

### Que ferramenta usar

| Pergunta | Chamada |
|---|---|
| Qual a arquitetura? | `architecture_overview` sem parâmetros |
| Quais componentes o time Y tem, e como se ligam? | `architecture_overview` com `team: "Y"` (ou `domain`) |
| O que está em volta do componente X? | `architecture_overview` com `component: "X"` e `depth: 1` (ou mais) |
| Quais frontends dependem de X? | `component_dependencies` com `component: "X"`, `direction: "in"`, `kind: "frontend"` e `depth: 3` (passa por BFFs e serviços intermediários) |
| De quais serviços X depende, direta ou indiretamente? | `component_dependencies` com `direction: "out"`, `kind: "service"` e `depth` |
| Quem chama a API de X, e quais endpoints? | `api_consumers` com `target: "X"` (e `endpoint: "GET /caminho"`) |
| Qual é o contrato do endpoint E da API de X? | `contract_get` com `target: "X"` (sem `endpoint`, lista os endpoints) e `endpoint: "POST /caminho"` (ou o `operationId`) |
| Quem publica e quem assina o tópico T? | `topic_get` |
| Quem usa a API X (ou o evento Y) em qualquer versão, e em qual? | `api_consumers` com `allVersions: true`; `topic_get` com o nome sem a versão (ou `allVersions: true`) |
| Quem usa a biblioteca L, e em que versão? | `library_usage` com `versionRange` opcional |
| Quem usa o framework interno F, em qualquer dos pacotes que ele gera? | `library_usage` com o componente |
| Quais bibliotecas X usa, e em que versão? | `component_libraries` |
| Stack, APIs e recursos de X | `component_get` |
| Onde X roda, e em que versão? | `component_get` (campo `deployments`; com `includeStale`, o histórico) |
| Quem consome o endpoint E em produção? | `api_consumers` com `environment: "env:prd"` |
| O que está em produção e já saiu do código (ou entrou depois)? | `component_compare` com `from: "env:prd"` |
| Que coleções ou tabelas X usa, e se lê ou escreve? | `component_get` (campo `data`) |
| Quem lê ou escreve a coleção C? | `dataset_get` |
| Por onde passa uma requisição para o host H? | `route_get` |
| Que nó tem "X" no nome? | `nodes_find` |
| Quem são as pessoas, e em que times estão? | `people_list` (com `group` para um time) |
| O que se liga ao sistema, recurso ou pessoa X? De que domínio é o sistema S? | `node_get` |
| Que fontes já carregaram, e quando? O que nenhuma fonte cobre? | `sources_status` |
| Onde as fontes discordam? | `fact_divergences` |

Resposta vazia com `coverage` ou `gaps` quer dizer que nenhuma fonte publica aquele tipo de fato (ex.: nenhum frontend publicado ainda). Diga "sem dados", não "não existe".

- Os nós podem ser informados por chave, apelido, nome ou último segmento da chave (`product-api`, `platform-starter`). Quando há ambiguidade, a ferramenta devolve os candidatos.
- A relação vista de um nó (`{ type, node, direction, facts }`) diz o sentido: `out` quando vai do nó dono para `node`, `in` quando vem de `node` para ele (ex.: em `contract_get` com `endpoint`, `apis` vem com `HAS_ENDPOINT` `in`).
- Cada relação vem com `facts`: uma afirmação por fonte e escopo, com `source`, `scope`, `state`, `status`, `evidence` e `observedAt`. Quando duas fontes discordam (ex.: versões diferentes), as duas aparecem.
- `detail: "summary"` reduz cada afirmação a `source`, `evidence` e `props` (com `status` e `state` só quando fogem do comum). É o padrão de `architecture_overview` e `components_list`; nas outras, o padrão é `full`.
- Só o retrato atual vem por padrão. Com `includeStale: true`, voltam também as afirmações que a fonte deixou de fazer, com a última data em que foram vistas.
- O retrato padrão é o da linha principal (o código mais recente publicado). Com `environment` (em `architecture_overview`, `component_get`, `api_consumers`, `contract_get`, `component_dependencies`, `topic_get`, `dataset_get`, `library_usage`, `component_libraries` e `route_get`), cada componente implantado naquele ambiente com retrato congelado aparece na versão em execução: o que ela oferece e usa, o contrato de cada endpoint, e `version` na ponta do componente. O resto (organização, infraestrutura, componente sem retrato da versão ou sem implantação conhecida) segue a linha principal.
- Os nós também têm `status`, derivado das afirmações: `current` enquanto alguma fonte afirma o nó ou uma relação current chega nele; `stale` quando todas deixaram de afirmar (ex.: o nome antigo de um serviço renomeado). Nós stale ficam fora das listas por padrão e não disputam uma referência ambígua com um nó current. `referenced: true` indica um nó que nenhuma fonte declarou: ele existe só como ponta de relação.
- Resposta vazia de um tipo de fato que nenhuma fonte publica (donos, estrutura organizacional) vem com `coverage`, para distinguir "sem dados" de "não existe".
- `graph_query` só aceita consultas de leitura. O plano é verificado com `EXPLAIN` e a consulta roda numa transação de leitura. `LOAD CSV` é recusado. Os limites são 5 s, 1000 linhas (padrão 100) e 40 mil caracteres de resultado. Quando corta, vem `truncated`, `truncatedBy` (`rows` ou `size`) e uma `note` que sugere agregar ou excluir as `DEPENDS_ON` de bibliotecas.

## Consulta (REST)

As mesmas ferramentas também respondem por `POST /v1/queries/<ferramenta>`, para quem não fala MCP: o console visual ([panorama-graph-web](../web/README.md)) e telas que mostram a consulta que um agente citou. O corpo são os argumentos da ferramenta, e a resposta é o mesmo JSON que o MCP devolve. As duas portas usam a mesma definição (`src/query/tools.ts`), então não divergem.

```sh
curl -s localhost:3200/v1/queries/component_dependencies -H 'content-type: application/json' \
  -d '{"component": "product-api", "direction": "in", "kind": "frontend", "depth": 3}'
```

- Sem corpo vale como sem argumentos (ex.: `POST /v1/queries/architecture_overview`). Argumento a mais ou inválido volta `400`.
- Erros de domínio voltam com o status e o corpo de erro único: `404` para nó não encontrado, `409` para nome ambíguo (`ambiguous`, com os candidatos em `details.candidates`) e `422` para consulta recusada (ex.: escrita no `graph_query`).
- **CORS** só nas rotas `/v1/queries`, para as origens de `CORS_ORIGINS` (separadas por vírgula). Ingestão e MCP não aceitam chamada do navegador.
- Sem autenticação, como o MCP (ver as perguntas em aberto do [ROADMAP](../ROADMAP.md#perguntas-em-aberto)).
- Ferramenta que não existe volta `404` (`unknown_tool`) com a versão do contrato em `details.contractVersion`.

## Contrato das consultas

Os nomes das ferramentas, os argumentos e o que as respostas trazem formam um contrato com versão própria, separada do `MODEL_VERSION` (o modelo que os adaptadores seguem). Quem guarda uma consulta para refazer depois, como as citações de um agente, depende dele.

- **Onde aparece:** `GET /v1/queries` (versão, política e cada ferramenta com os argumentos, a versão em que entrou e se é estável), `queryContractVersion` no `GET /v1/schema`, o cabeçalho `Query-Contract-Version` em toda resposta do REST e o `_meta["panorama-graph/contract"]` de cada ferramenta no `tools/list` do MCP.
- **Na mesma versão** só entram mudanças compatíveis: ferramenta nova, argumento novo opcional, valor novo num enum e campo novo nas respostas.
- **Versão nova** para renomear ou remover ferramenta, argumento ou campo de resposta, tornar argumento obrigatório, tirar valor de enum ou mudar o tipo ou o sentido de um argumento. O que sai fica obsoleto por pelo menos uma versão antes de ser removido, com as duas formas servidas. A ferramenta obsoleta avisa na descrição, no `_meta` (`deprecated`, com a substituta) e no REST (`Deprecation: true` e `Link` com `rel="successor-version"`).
- **`graph_query` é exploratória** e fica fora do contrato.

O contrato publicado de cada versão fica em `contract/queries-v<N>.json`. Um teste falha quando as ferramentas mudam e o snapshot não; para atualizá-lo, `pnpm run contract:write`, que recusa a mudança incompatível e pede a versão nova (`QUERY_CONTRACT_VERSION` em `src/query/contract.ts`). O snapshot confere nomes, argumentos, tipos, obrigatoriedade e enums, e traz a forma de cada resposta (`output`, com as formas em `definitions`, em JSON Schema): na mesma versão, remover campo, deixar de mandar sempre um campo, mudar o tipo ou passar a mandar nulo também é recusado. A forma das respostas é declarada em `src/query/responses.ts`.

## SDK

O pacote npm `@panorama-graph/sdk` ([sdks/typescript](../sdks/typescript/README.md)) é gerado do contrato desta API: os tipos de cada corpo e resposta, o modelo (versão, tipos de nó com o prefixo da chave, tipos de relação), as receitas de chave e um cliente do REST. Toda mudança no OpenAPI ou no modelo termina com `pnpm run openapi:write && pnpm run sdk:generate`; um teste falha quando os arquivos gerados ficam para trás, e outro usa o cliente do SDK contra esta API. Com o SDK mudado, suba a versão em `../sdks/typescript/package.json`: o job `publish_sdk` do pipeline (na raiz) publica a versão que ainda não está no registry.

## Testes

Os testes rodam contra um Neo4j separado e descartável (dados em memória), que é apagado entre os testes:

```sh
pnpm run test:db:up
pnpm test
pnpm run lint
```

O grafo dos testes ([test/fixtures/acme.ts](test/fixtures/acme.ts)) é um pedaço do ACME Bank, a organização fictícia de exemplo, carregado pelo REST como os adaptadores fariam. Os testes das consultas respondem sobre ele às perguntas que o grafo existe para responder, com a fonte de cada fato:

1. Quem chama a `product-catalog-api`? Esperado: `loan-simulation-api`, pelo Pact, pelo cliente HTTP e pela configuração do Helm.
2. De quais endpoints da `product-catalog-api` a `loan-simulation-api` depende? Esperado: os das interações do pact.
3. Quem publica e quem consome `credit.product-catalog.product-created`?
4. Qual banco a `product-catalog-api` usa, e em que motor e versão? Esperado: o banco `product-catalog`, no servidor MongoDB do `dev`, ligado ao componente mesmo com o nome antigo (teste de apelido).
5. Quais componentes usam PostgreSQL, e algum banco lógico é compartilhado entre componentes?
6. Quais componentes do domínio Crédito existem, e quem é dono de cada um?
7. Quais componentes usam a biblioteca interna, e em que versão?
8. Por onde passa uma requisição para `product-catalog-api.dev.acmebank.example`?
9. Quais coleções a `product-catalog-api` usa? Esperado: `products` e `sequences`, com `OWNS_DATA` e evidência no `@Document`, e leitura e escrita com a linha do código.
