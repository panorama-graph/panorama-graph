<p align="center"><img src="assets/logo.svg" alt="Panorama Graph" width="360"></p>

# Panorama Graph

**A estrutura da organização, dos times à arquitetura, para agentes de IA consultarem e citarem.** Operações estruturadas pelo MCP e pelo REST respondem quem é dono de quê, como os sistemas se ligam e o que roda em cada ambiente, e cada afirmação vem com a fonte e a evidência de onde saiu.

## Propósito

Agentes de IA que planejam e constroem software numa empresa não sabem o que já existe nela. Sem esse contexto, tratam cada iniciativa como se começasse do zero: supõem a stack, inventam integrações e deixam em branco o dono e o time. A wiki responde **como se deve fazer**. O Panorama Graph responde **o que existe, quem é dono e como as partes se ligam**, e diz de onde veio cada resposta, para o agente citar em vez de supor.

- **Visão dos times:** níveis da organização, grupos e pessoas, e quem é dono de cada domínio, sistema, componente e API.
- **Visão da arquitetura:** domínios, sistemas e componentes; APIs, endpoints, eventos e contratos; bancos e quem os acessa; bibliotecas e tecnologias; rotas de entrada e o que roda, em que versão, em cada ambiente.
- **Operações estruturadas:** consultas com nome, parâmetros e resposta definidos num contrato versionado, em vez de texto livre. As respostas são pequenas e diretas, pensadas para caber no contexto de um agente. Para o que nenhuma consulta cobre, há o `graph_query`, em Cypher só de leitura.
- **Citação da fonte em cada afirmação:** toda relação traz uma afirmação por fonte, com a fonte, a evidência (`repo@sha:caminho`), o estado (`observed`, `inferred` ou `confirmed`), se ainda vale (`current` ou `stale`) e quando foi vista. Fato sem proveniência é recusado na entrada.
- **Fontes que discordam ficam lado a lado:** uma fonte não sobrescreve a outra, e a divergência entre elas é consultável (`fact_divergences`).
- **Retrato atual que se corrige sozinho:** cada fonte envia o retrato completo do seu escopo, e o que deixou de ser afirmado vira `stale`, com a última data vista, em vez de ficar no grafo como se ainda valesse.
- **Dependência separada do caminho de rede:** quem depende de quem (`CONSUMES`, `CALLS`) não se confunde com por onde a requisição passa (`ROUTES`), e um gateway no meio não esconde a dependência real.
- **Alimentado pelo que já existe:** os dados vêm do build (plugin Gradle, SBOM, OpenAPI, AsyncAPI, Pact), do cluster e dos exports da organização, por adaptadores à parte. O que um agente deduz entra como `inferred` e nunca vira verdade sozinho.
- **Também para pessoas:** um console mostra o mesmo grafo, com as fontes e as divergências, para quem precisa conferir e confiar no que os agentes consultam.

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

Tudo fica neste repositório, um workspace do Bun: uma mudança no modelo chega à API, ao SDK, aos adaptadores e ao console no mesmo commit.

| Pasta | O que é |
|---|---|
| [api](api/README.md) | Base e API: modelo, registro com proveniência, consultas (MCP e REST) e o contrato de onde os SDKs são gerados |
| [web](web/README.md) | Console: consultar o grafo e conferir as fontes |
| [sdks/typescript](sdks/typescript/README.md) | SDK em TypeScript (`@panorama-graph/sdk`): tipos e modelo gerados do contrato, receitas de chave e cliente do REST. É o artefato publicado para quem escreve o adaptador da própria organização |
| [adapters](adapters/README.md) | Os adaptadores do produto: `graph-publish` (a arquitetura do build, no CI de cada componente), `graph-deployments` (o que roda em cada ambiente, lido do cluster), `graph-seed` (retratos em YAML, para a carga à mão) e `graph-receiver` (recebe os pacotes de build do plugin Gradle). Tem os formatos dos artefatos (`schemas/`) e o resto da carga de exemplo (`seeds/acme/`) |
| [gradle-plugin](gradle-plugin/README.md) | Plugin Gradle `panorama-graph` e a biblioteca de teste para Spring: geram em `build/architecture` o que o build sabe do componente e o enviam ao receptor. Build Gradle próprio, fora do workspace |
| [example-seed](example-seed/README.md) | Exemplo de adaptador próprio de uma organização: traduz o export do diretório (níveis, grupos e pessoas) e o inventário da infraestrutura e os publica pelo SDK. Carrega a organização de exemplo e é o ponto de partida para o adaptador da sua |
| [agent-skills](agent-skills/README.md) | Skills para agentes de IA. A `panorama-graph-carga-manual` alimenta o grafo com a arquitetura real de repositórios que ainda não usam os adaptadores, sem modificar os projetos |

- [PRIMEIROS-PASSOS.md](PRIMEIROS-PASSOS.md): subir, carregar o exemplo e consultar, e a primeira carga da sua organização.
- [MODELO.md](api/MODELO.md): nós e relações, o que é fixo e o que é livre, e o que fazer quando algo não cabe.
- [ROADMAP.md](ROADMAP.md): o que já existe e o que vem pela frente.
- [PROVENIENCIA.md](api/PROVENIENCIA.md): as regras de proveniência e ciclo de vida dos fatos.
- [PROPOSITO.md](api/PROPOSITO.md): por que existe e o que não é.
- [ADOCAO.md](ADOCAO.md): levar os adaptadores a uma organização (convenções, ordem de implantação, pipeline, cluster e conferência).
- [AGENTS.md](AGENTS.md): como trabalhar no repositório.

## Subir

```sh
cp .env.example .env
docker compose --profile exemplo up -d --build    # sem --profile exemplo, a instância vazia
```

| Serviço | Endereço |
|---|---|
| Console | <http://localhost:5180> |
| API (REST em `/v1`, MCP em `/mcp`) | <http://localhost:3200> |
| Receptor dos builds (`graph-receiver`, para onde o plugin Gradle envia) | <http://localhost:3210> |
| Neo4j Browser | <http://localhost:7474> (usuário `neo4j`, senha do `.env`) |

Para um agente consultar, ligue o MCP ao cliente. No Claude Code:

```sh
claude mcp add --transport http panorama-graph http://localhost:3200/mcp
```

A API ainda não tem autenticação (está no [roadmap](ROADMAP.md)): exponha-a só numa rede interna.

## Licença

[Sustainable Use License 1.0](LICENSE), que vale para todo o repositório, inclusive o SDK publicado. Empresas podem usar e modificar o grafo para os próprios fins internos, e qualquer pessoa pode usá-lo para fins pessoais ou não comerciais. Vender o grafo, ou oferecê-lo a terceiros como produto ou serviço pago, não é permitido. A redistribuição só pode ser gratuita e para fins não comerciais, sempre com a licença junto.

## Desenvolver

```sh
bun install          # na raiz: instala todos os projetos do workspace, com o SDK ligado ao código
bun run lint         # tsc em todos os projetos
bun run test         # testes de todos os projetos (a API precisa do Neo4j de teste: bun run test:db:up em api/)
```

Cada projeto também roda sozinho na própria pasta (`bun run lint`, `bun test`, `bun run dev`). O `gradle-plugin` usa o próprio wrapper (`./gradlew build`).
