# panorama-graph-web

Console visual do [panorama-graph-api](../api/README.md). Mostra o grafo da arquitetura e da estrutura organizacional, e de onde veio cada fato: a fonte, a evidência, o estado e a data.

É uma tela de leitura sobre as mesmas consultas que os agentes usam pelo MCP (`POST /v1/queries/<ferramenta>`). Não é portal de desenvolvedor: não tem templates de projeto, scorecards, documentação nem cadastro à mão (ver o [PROPOSITO](../api/PROPOSITO.md)).

## O que tem

**Consultar**

| Tela | Consulta |
|---|---|
| Busca (topo e `/busca`) | `nodes_find`: nome, chave ou apelido, em qualquer tipo de nó; só com o tipo (`/busca?tipo=Resource`), todos os nós dele. Os contadores por tipo da visão geral levam para cá |
| Visão geral (`/`) | `architecture_overview`: componentes, dependências e o que cada um usa em grafo, tópicos, nós por tipo, fontes e lacunas, com recorte por domínio, time ou ambiente (só os recursos do ambiente). Camadas (`?camadas=`) marcam o que entra: por padrão service, bff, frontend e job, com API e eventos; bancos, cache, mensageria, bibliotecas e a infraestrutura (servidores e brokers, com o domínio deles, e o "está em" do banco e do tópico) quando ligados; com a camada library, quem usa um framework ou biblioteca interna aponta para o componente que a gera, com o pacote e a versão no rótulo (as bibliotecas de terceiros não entram), um nó por recurso juntando os ambientes; um contorno por domínio, que se desliga em "Agrupar"; a ligação por API mostra o endpoint chamado no rótulo, ou, com mais de um, o botão que os lista |
| Componentes (`/componentes`) | `components_list`, com filtros de domínio, time, tipo e tecnologia |
| Quem usa (`/quem-usa`) | Uma entrada só para "quem usa X?": escolhe-se o quê (API, tópico ou fila, biblioteca), o item e, se quiser, o ambiente. API: `api_consumers` com `allVersions` (ou a versão escolhida), com o que cada consumidor chama; tópico: `topic_get` com `allVersions` (ou a versão), quem publica e quem assina; biblioteca (ou o componente que gera bibliotecas, com o pacote de cada uso): `library_usage`, com faixa de versão e uso direto ou transitivo. Vem o resumo das versões em uso e a tabela de quem usa, em que versão, como e com quais fontes. Tudo na URL (`?tipo=&item=&versao=&ambiente=`), para mandar a pergunta pronta |
| Componente (`/n/<chave>`) | `component_get` (ficha, com as implantações: ambiente, versão, commit, desde quando e se é o commit da linha principal; num componente do tipo biblioteca, os pacotes que ele gera no lugar das APIs, e o que é de execução só se alguma fonte afirmar), `architecture_overview` com `component` (vizinhança), `component_dependencies` (dependências, com tipo e caminhos; não aparece num componente do tipo biblioteca, cujo código só roda dentro de quem o usa), `api_consumers` (quem consome; num componente do tipo biblioteca, a aba Quem usa: `library_usage` com o componente, os pacotes que ele gera e quem usa cada um), `component_libraries` (bibliotecas: as diretas, as transitivas com as diretas que as trazem e as declaradas sem uso), `component_compare` (comparação entre dois retratos: o que entrou, saiu ou mudou) e `node_get` (todas as relações). "Ver como está no ambiente" (`?ambiente=`) passa `environment` à ficha, à vizinhança, às dependências e aos consumidores: cada componente aparece na versão implantada ali |
| API e endpoint | `contract_get` (endpoints, contratos e o contrato da operação) e `api_consumers` |
| Tópico, dataset, biblioteca, grupo | `topic_get` (com as versões do mesmo tópico), `dataset_get`, `library_usage` (versões em uso, quem usa com filtro de faixa e de uso direto ou transitivo, e o componente que gera a biblioteca), `org_structure` |
| Demais nós (sistema, domínio, recurso, pessoa...) | `node_get` |
| Organização (`/organizacao`) | `org_structure`: organograma dos grupos, com o nível de cada um (nome e cor do nível na organização), os membros (papel e quem lidera) no cartão, o que cada grupo possui por tipo, que abre para listar os itens, e o painel do grupo; filtro por raiz, destaque de pessoa ou grupo, recolher e posses abertas na URL |

**Confiar**

| Tela | Consulta |
|---|---|
| Fontes e cargas (`/fontes`) | `sources_status`: cobertura por tipo de fato, escopos de cada fonte com o último retrato, cargas recentes |
| Divergências (`/divergencias`) | `fact_divergences`: onde as fontes discordam |
| Nós referenciados (`/referenciados`) | `nodes_find` com `referencedOnly`: nós que nenhuma fonte declarou |

Em toda relação, o selo de fontes abre as afirmações: fonte, estado (observado, inferido, confirmado), vigência, escopo, evidência (com link), datas e propriedades, com as fontes que discordam lado a lado. "Incluir o que sumiu" (`?stale=1`) mostra também o que as fontes deixaram de afirmar. Cada tela mostra a consulta feita, para refazê-la pelo MCP.

## Stack

React 18, Vite, MUI, Tailwind, React Query, React Router e React Flow (com dagre para o layout).

## Subir

A API precisa estar no ar (porta 3200) com `http://localhost:5180` no `CORS_ORIGINS` dela.

```sh
cp .env.example .env
bun install
bun run dev                 # http://localhost:5180
```

Em container, com a API e o Neo4j: o compose da raiz (ver os [primeiros passos](../PRIMEIROS-PASSOS.md)), que passa as duas variáveis abaixo no build.

| Variável | Para quê |
|---|---|
| `VITE_GRAPH_API_URL` | REST do panorama-graph-api. Padrão: `http://localhost:3200` |
| `VITE_EVIDENCE_URL_TEMPLATE` | Opcional. Link das evidências no formato `repo@sha:caminho`, com `{repo}`, `{sha}` e `{path}`. A linha, quando a evidência traz, entra como `#L<linha>`. Ex.: `https://gitlab.example.com/{repo}/-/blob/{sha}/{path}` |

As duas entram no build (o Vite as embute no JS).

## Testes

`bun run lint` (tsc), `bun test` (funções puras: evidência, propriedades por fonte, layout do grafo) e `bun run build`.
