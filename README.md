<p align="center"><img src="assets/logo.svg" alt="Panorama Graph" width="360"></p>

# Panorama Graph

**Uma visão da organização e da arquitetura para agentes de IA consultarem e citarem.** Quem são as pessoas e os times, de que cada time é dono, quais componentes existem, como se ligam e o que roda em cada ambiente, com a fonte e a evidência de cada resposta.

## O problema

Agentes de IA que planejam, especificam e constroem software numa empresa não sabem o que já existe nela. Sem esse contexto, cada iniciativa começa do zero: o agente supõe a stack, inventa integrações, assume um provedor de nuvem que a empresa não usa e deixa em branco quem é dono do quê.

O primeiro reflexo é dar ao agente acesso aos repositórios e deixar que ele leia. Não funciona:

- **Escala e custo.** Uma organização tem centenas de repositórios. Cada pergunta viraria uma varredura, e o contexto do agente é o recurso mais caro que há.
- **O código não diz tudo.** A versão efetiva de cada dependência, a interface depois das anotações e configurações, a coleção realmente mapeada: isso só se resolve no build. O que está em produção, e em que versão, não está no código.
- **Há peças que não aparecem em código.** Gateways, brokers, bancos gerenciados e compartilhados, regras de roteamento: existem na plataforma, em manifestos de infraestrutura ou num CMDB, muitas vezes em nenhum repositório que o time veja.
- **A organização não está no código.** Em que time uma pessoa está, como os times se agrupam e quem é dono de cada componente vive no diretório corporativo e no catálogo de serviços.

E o que o agente deduz lendo é um palpite sem proveniência: ele não sabe dizer de onde tirou, nem separar o que viu do que supôs. A wiki e os golden paths respondem **como se deve fazer**. Falta quem responda **o que existe, quem é dono e como as partes se ligam**, de um jeito que o agente possa **citar em vez de supor**.

Um exemplo do contexto que faz diferença: ao atender uma pessoa, o agente precisa saber em que time ela trabalha, onde esse time está na organização e quais componentes são relevantes para ela: o que o time é dono, o que esses componentes consomem, quem os consome, que bancos e eventos tocam. Com isso, uma iniciativa nova já nasce ligada ao que existe.

## A proposta

O Panorama Graph é um **grafo da arquitetura e da estrutura organizacional**, alimentado pelas fontes que a organização já tem e consultado pelos agentes por operações feitas para eles.

**Por que um grafo.** As perguntas que importam são perguntas de relação e de caminho: "o que é relevante para esta pessoa" atravessa pessoa, time, componentes do time, APIs que eles oferecem e quem as consome; "quais frontends dependem de X" passa por intermediários; "quem mais acessa este banco" parte de um recurso e volta aos componentes. Num grafo, a vizinhança de um nó e o caminho entre dois nós são as operações naturais. E várias fontes falam do mesmo nó (o catálogo diz quem é o dono, o build diz o que o componente consome, o cluster diz onde ele roda): num grafo cada fonte grava a sua própria relação, lado a lado com as outras, e a divergência fica visível.

**Por que não entregar o banco ao agente.** Um banco de grafo com uma linguagem de consulta parece flexível, mas o agente gasta contexto descobrindo o esquema, erra a consulta, traz resultados grandes demais e não aplica as regras que tornam a resposta correta: o que ainda vale e o que já saiu, a versão que roda em cada ambiente, a proveniência de cada fato. Por isso o grafo oferece **operações com nome, parâmetros e resposta definidos**, uma para cada tipo de pergunta, servidas por MCP aos agentes e por REST a qualquer outro consumidor. Cada operação já aplica vigência, ambiente e limite de tamanho, e devolve a fonte de cada relação. A consulta livre existe, só de leitura e cercada, como válvula de escape para o que nenhuma operação cobre.

O agente não ganha um banco. Ganha algo mais parecido com um colega que responde perguntas e diz de onde tirou cada resposta.

### O que ele guarda e como se comporta

- **Visão dos times:** níveis da organização, grupos e pessoas, e quem é dono de cada domínio, sistema, componente e API.
- **Visão da arquitetura:** domínios, sistemas e componentes; APIs, endpoints, eventos e contratos; bancos e quem os acessa; bibliotecas e tecnologias; rotas de entrada e o que roda, em que versão, em cada ambiente.
- **Citação da fonte em cada afirmação:** toda relação traz uma afirmação por fonte, com a evidência (`repo@sha:caminho`), o estado (`observed`, `inferred` ou `confirmed`), se ainda vale (`current` ou `stale`) e quando foi vista. Fato sem proveniência é recusado na entrada.
- **Fontes que discordam ficam lado a lado:** uma fonte não sobrescreve a outra, e a divergência entre elas é consultável (`fact_divergences`).
- **Retrato atual que se corrige sozinho:** cada fonte envia o retrato completo do seu escopo, e o que deixou de ser afirmado vira `stale`, com a última data vista, em vez de ficar no grafo como se ainda valesse.
- **Dependência separada do caminho de rede:** quem depende de quem (`CONSUMES`, `CALLS`) não se confunde com por onde a requisição passa (`ROUTES`), e um gateway no meio não esconde a dependência real.
- **Alimentado pelo que já existe:** os dados vêm do build (plugin Gradle, SBOM, OpenAPI, AsyncAPI, Pact), do cluster e dos exports da organização, por adaptadores à parte. O que um agente deduz entra como `inferred` e nunca vira verdade sozinho.
- **Também para pessoas:** um console web mostra o mesmo grafo, com as fontes e as divergências, para quem precisa conferir e confiar no que os agentes consultam.

O que ele não é (portal de desenvolvedor, APM, CMDB, catálogo de dados) e as inspirações estão no [PROPOSITO.md](api/PROPOSITO.md).

### As operações

| Para responder | Operações |
|---|---|
| Visão geral e busca | `architecture_overview`, `nodes_find`, `node_get` |
| Times e pessoas | `org_structure`, `people_list` |
| Componentes | `components_list`, `component_get`, `component_dependencies`, `component_compare`, `component_libraries` |
| Quem usa o quê | `api_consumers`, `contract_get`, `topic_get`, `dataset_get`, `library_usage`, `route_get` |
| Confiança nas fontes | `sources_status`, `fact_divergences` |
| Consulta livre, só leitura | `graph_query` |

As mesmas operações estão no MCP (`/mcp`) e no REST (`POST /v1/queries/<operação>`, com OpenAPI em `/v1/openapi.json`). Um trecho da resposta de `api_consumers` para o `product-catalog-api` da organização de exemplo: o `loan-simulation-api` consome a API, e duas fontes independentes afirmam isso, cada uma com a sua evidência.

```json
{
  "component": { "key": "component:acme/credito/loan-simulation-api", "name": "loan-simulation-api" },
  "consumes": [{
    "type": "CONSUMES",
    "node": { "key": "api:product-catalog/http", "name": "Product Catalog API" },
    "facts": [
      { "source": "pact", "state": "observed", "status": "current", "observedAt": "2026-10-01T00:00:00.000Z",
        "evidence": "acme/credito/loan-simulation-api@edf89ec…:build/architecture/pacts/loan-simulation-api-product-catalog.json" },
      { "source": "http-clients", "state": "observed", "status": "current", "observedAt": "2026-10-01T00:00:00.000Z",
        "evidence": "acme/credito/loan-simulation-api@edf89ec…:src/main/java/…/catalog/CatalogApi.java" }
    ]
  }]
}
```

## O repositório

Este repositório é o produto: a API, o console e o SDK, num workspace do Bun. Uma mudança no modelo chega aos três no mesmo commit.

| Pasta | O que é |
|---|---|
| [api](api/README.md) | Base e API: modelo, registro com proveniência, consultas (MCP e REST) e o contrato de onde os SDKs são gerados |
| [web](web/README.md) | Console: consultar o grafo e conferir as fontes |
| [sdks/typescript](sdks/typescript/README.md) | SDK em TypeScript (`@panorama-graph/sdk`): tipos e modelo gerados do contrato, receitas de chave e cliente do REST. É o artefato publicado para quem escreve um adaptador |

O que alimenta o grafo fica em repositórios próprios, que dependem só do que este publica (o SDK e o contrato da API):

| Repositório | O que é |
|---|---|
| [adapters](https://github.com/panorama-graph/adapters) | Os adaptadores do produto: `graph-publish` (a arquitetura do build, no CI de cada componente), `graph-deployments` (o que roda em cada ambiente, lido do cluster), `graph-seed` (retratos em YAML, para a carga à mão) e `graph-receiver` (recebe os pacotes de build do plugin Gradle). Tem os formatos dos artefatos de build (`schemas/`), a organização de exemplo e o `example-seed`, ponto de partida para o adaptador próprio de uma organização |
| [gradle-plugin](https://github.com/panorama-graph/gradle-plugin) | Plugin Gradle `panorama-graph` e a biblioteca de teste para Spring: geram em `build/architecture` o que o build sabe do componente e o enviam ao receptor |
| [skills](https://github.com/panorama-graph/skills) | Skills para agentes de IA. A `panorama-graph-carga-manual` alimenta o grafo com a arquitetura real de repositórios que ainda não usam os adaptadores, sem modificar os projetos |

- [PRIMEIROS-PASSOS.md](PRIMEIROS-PASSOS.md): subir, carregar o exemplo e consultar, e a primeira carga da sua organização.
- [MODELO.md](api/MODELO.md): nós e relações, o que é fixo e o que é livre, e o que fazer quando algo não cabe.
- [ROADMAP.md](ROADMAP.md): o que já existe e o que vem pela frente.
- [PROVENIENCIA.md](api/PROVENIENCIA.md): as regras de proveniência e ciclo de vida dos fatos.
- [ADAPTADOR.md](api/ADAPTADOR.md): escrever um adaptador sem o SDK, com as receitas de chave e um exemplo de carga para cada relação.
- [PROPOSITO.md](api/PROPOSITO.md): por que existe e o que não é.
- [ADOCAO.md](ADOCAO.md): levar o grafo a uma organização (convenções, ordem de implantação, pipeline, cluster e conferência).
- [AGENTS.md](AGENTS.md): como trabalhar no repositório.

## Subir

```sh
cp .env.example .env
docker compose up -d --build
```

A instância sobe vazia. Para carregar a organização de exemplo e receber os builds, suba também o [repositório dos adaptadores](https://github.com/panorama-graph/adapters), como nos [primeiros passos](PRIMEIROS-PASSOS.md).

| Serviço | Endereço |
|---|---|
| Console | <http://localhost:5180> |
| API (REST em `/v1`, MCP em `/mcp`) | <http://localhost:3200> |
| Neo4j Browser | <http://localhost:7474> (usuário `neo4j`, senha do `.env`) |

Para um agente consultar, ligue o MCP ao cliente. No Claude Code:

```sh
claude mcp add --transport http panorama-graph http://localhost:3200/mcp
```

A API ainda não tem autenticação (está no [roadmap](ROADMAP.md)): exponha-a só numa rede interna.

## Licença

Todo o repositório, inclusive o SDK publicado, está sob a [Sustainable Use License 1.0](LICENSE). Em resumo: você pode usar e modificar o Panorama Graph dentro da sua organização, ou para uso pessoal e não comercial, sem pagar nada. O que a licença não permite é vendê-lo ou oferecê-lo a terceiros como produto ou serviço. Se redistribuir, faça-o de graça, para fins não comerciais, mantendo a licença e os avisos de autoria. O texto completo, que é o que vale, está no arquivo [LICENSE](LICENSE).

## Desenvolver

```sh
bun install          # na raiz: instala todos os projetos do workspace, com o SDK ligado ao código
bun run lint         # tsc em todos os projetos
bun run test         # testes de todos os projetos (a API precisa do Neo4j de teste: bun run test:db:up em api/)
```

Para trabalhar num projeto só, entre na pasta dele e use os mesmos comandos (`bun run lint`, `bun test`, `bun run dev`).
