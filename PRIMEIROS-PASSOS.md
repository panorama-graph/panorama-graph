# Primeiros passos

Do zero a um grafo consultável: subir a instância, carregar a organização de exemplo e consultar pelo console e pelo MCP. Depois, trocar o exemplo pelos dados da sua organização.

## O que é preciso

- Docker com o Compose v2.
- Git, para baixar este repositório e o dos [adaptadores](https://github.com/panorama-graph/adapters), que carrega o exemplo e recebe os builds.
- Para consultar pelo MCP: um cliente MCP, como o Claude Code.

## 1. Baixar e configurar

```sh
git clone https://github.com/panorama-graph/panorama-graph.git
git clone https://github.com/panorama-graph/adapters.git
cd panorama-graph && cp .env.example .env   # troque NEO4J_PASSWORD
```

## 2. Subir e carregar o exemplo

```sh
docker compose up -d --build                     # em panorama-graph/: Neo4j, API e console, com o grafo vazio
curl -s http://localhost:3200/health/ready       # o Neo4j responde
```

Com a API no ar, o repositório dos adaptadores sobe o receptor dos builds (`graph-receiver`, porta 3210) e carrega o exemplo:

```sh
cd ../adapters
docker compose --profile exemplo up -d --build   # chama a API em http://localhost:3200 (GRAPH_API_URL muda)
```

Os serviços `exemplo` e `exemplo-organizacao` rodam uma vez, carregam a organização fictícia ACME Bank e saem:

- a organização (diretorias, times e pessoas) e a infraestrutura dos ambientes `dev`, `stage` e `prd` (servidores, bancos e rotas), traduzidas dos exports do ACME Bank pelo `example-seed`, o exemplo de adaptador próprio de uma organização;
- a carga à mão de `seeds/acme`: catálogo (domínios, sistemas e donos) e bancos de cada serviço;
- a arquitetura de build de dois serviços, `product-catalog-api` e `loan-simulation-api`, a partir de artefatos reais de build (`test/fixtures`): stack, bibliotecas, endpoints, eventos, clientes HTTP, coleções e o contrato Pact entre os dois.

Para conferir, ainda em `adapters/`:

```sh
docker compose logs exemplo exemplo-organizacao  # uma linha por retrato carregado
```

O exemplo nunca sobrescreve dados mais novos. As afirmações dele têm uma data fixa, e a API recusa como mais antigo (`outdated`) qualquer retrato de um escopo que já tem um mais novo.

## 3. Consultar pelo console

Abra <http://localhost:5180>.

- **Visão geral:** os componentes, quem chama quem e os recursos de cada um. Filtre por domínio, time ou ambiente.
- **Ficha de um componente:** busque `product-catalog-api`. A ficha mostra o dono, o sistema, a stack, os endpoints, os consumidores, as coleções e os bancos.
- **Fontes:** de onde vêm os fatos (as cargas do exemplo aparecem como `directory`, `service-catalog`, `k8s-infra`, `build-manifest`, `pact`...) e o que nenhuma fonte cobre.

Em toda relação, o selo de fontes abre as afirmações: fonte, evidência, estado e data.

## 4. Consultar pelo MCP

```sh
claude mcp add --transport http panorama-graph http://localhost:3200/mcp
```

Perguntas que o exemplo responde, com a fonte de cada fato:

| Pergunta | Ferramenta |
|---|---|
| Qual a arquitetura? | `architecture_overview` |
| Quem chama a `product-catalog-api`, e quais endpoints? | `api_consumers` |
| Quais coleções a `product-catalog-api` lê e escreve? | `component_get` (`data`) ou `dataset_get` |
| Qual banco ela usa em `dev`, e em que motor e versão? | `component_get` |
| Por onde passa uma requisição para `product-catalog-api.dev.acmebank.example`? | `route_get` |
| Quais componentes o domínio Crédito tem, e quem é dono de cada um? | `components_list` e `org_structure` |
| Quem usa o Spring Boot, e em que versão? | `library_usage` |
| Quais bibliotecas o X usa, e quais ele declara sem usar? | `component_libraries` |

As mesmas consultas estão no REST, em `POST /v1/queries/<ferramenta>` (contrato em <http://localhost:3200/v1/openapi.json>):

```sh
curl -s -X POST http://localhost:3200/v1/queries/api_consumers \
  -H 'content-type: application/json' -d '{"target":"product-catalog-api"}'
```

## 5. Carregar a sua organização

O que o grafo aceita (os tipos de nó e de relação, o que é fixo e o que é livre, e o que fazer quando algo não cabe) está no [MODELO.md](api/MODELO.md). Os fatos chegam por adaptadores ([adapters](https://github.com/panorama-graph/adapters) e [gradle-plugin](https://github.com/panorama-graph/gradle-plugin)), cada um com a sua fonte:

| Adaptador | O que publica | Onde roda |
|---|---|---|
| Plugin Gradle `panorama-graph` | Gera o `build/architecture` de um projeto Gradle, só com o que o projeto tem de onde tirar, e o envia ao receptor (`./gradlew architecturePublish`, [gradle-plugin](https://github.com/panorama-graph/gradle-plugin)) | No build de cada componente |
| `graph-receiver` | A arquitetura de build de um componente (`build/architecture`: manifesto, SBOM, OpenAPI, AsyncAPI, clientes HTTP, acesso a dados, pacts), recebida do build | Ao lado da instância (serviço `receptor` do compose dos adaptadores, porta 3210) |
| `graph-publish` | O mesmo que o receptor, lendo o diretório: para builds que não são Gradle e não enviam o pacote | No CI de cada componente |
| `graph-deployments` | O que roda em cada ambiente, com a versão e o commit | No cluster, como CronJob |
| `graph-seed` | Retratos declarados em YAML, para o que ainda não tem adaptador (organização, catálogo, infraestrutura) | À mão |

Para o que nenhum deles lê (o diretório de pessoas, o CMDB, o inventário da infraestrutura), a organização escreve o próprio adaptador. O ponto de partida é o [example-seed](https://github.com/panorama-graph/adapters/tree/main/example-seed): ele lê o export do diretório e o inventário da infraestrutura, traduz com as receitas de chave do SDK, confere contra o modelo e publica, e é ele que carrega times, pessoas e infraestrutura no exemplo. Copie-o e troque a leitura dos arquivos pela das suas fontes.

Para experimentar com os seus repositórios sem modificá-los, um agente de IA pode descobrir os fatos e carregá-los pela skill [panorama-graph-ingestao](https://github.com/panorama-graph/skills#readme). A skill conhece o modelo e lê o código e os acessos que o agente tiver, como o cluster, o catálogo e o diretório. Antes de enviar, ela confere tudo pelo dry-run da ingestão.

Os formatos dos artefatos estão em [`schemas/`](https://github.com/panorama-graph/adapters/tree/main/schemas) dos adaptadores, e o uso de cada um no [README dos adaptadores](https://github.com/panorama-graph/adapters#readme). Para implantá-los na organização (convenções, ordem, pipeline e cluster), siga o guia de [adoção](ADOCAO.md).

### Primeira carga à mão

Para começar sem o exemplo, recrie o banco (apaga tudo), em `panorama-graph/`:

```sh
docker compose down -v && docker compose up -d --build
```

Em `adapters/`, crie a pasta `carga/` ao lado do compose, com um ou mais arquivos `*.yaml`. Cada item de `snapshots` é um **retrato**: tudo o que uma fonte (`source`) afirma num escopo (`scope`). Este exemplo declara os níveis da estrutura, um time, um domínio, dois serviços em que um chama a API do outro, e o banco de um deles em `dev`:

```yaml
# carga/organizacao.yaml
snapshots:
  - source: directory                       # de onde vêm os fatos: o diretório da empresa
    scope: { tenant: example }
    evidenceBase: "https://directory.example.com/"
    nodes:
      - { key: level:area, name: Área, order: 1, evidence: levels/area }
      - { key: level:team, name: Time, order: 2, team: true, evidence: levels/team }
      - { key: group:engineering, name: Engenharia, evidence: groups/engineering }
      - { key: group:catalog-team, name: Time Catálogo, evidence: groups/catalog-team }
      - { key: person:maria.silva, name: Maria Silva, email: maria.silva@example.com, evidence: users/maria.silva }
    relations:
      - { type: AT_LEVEL, from: group:engineering, to: level:area, evidence: groups/engineering }
      - { type: AT_LEVEL, from: group:catalog-team, to: level:team, evidence: groups/catalog-team }
      - { type: PART_OF, from: group:catalog-team, to: group:engineering, evidence: groups/catalog-team }
      - { type: MEMBER_OF, from: person:maria.silva, to: group:catalog-team, role: Tech Lead, lead: true, evidence: users/maria.silva }

  - source: service-catalog                 # o catálogo de serviços
    scope: { catalog: example }
    evidenceBase: "https://catalog.example.com/"
    nodes:
      - { key: domain:catalog, name: Catálogo, evidence: domains/catalog }
      - { key: system:catalog/products, name: Produtos, evidence: systems/products }
      - { key: component:example/catalog/product-api, kind: service, name: product-api, evidence: components/product-api }
      - { key: component:example/checkout/checkout-api, kind: service, name: checkout-api, evidence: components/checkout-api }
      - { key: api:product-api/http, kind: http, name: product-api, evidence: components/product-api }
    relations:
      - { type: PART_OF, from: system:catalog/products, to: domain:catalog, evidence: systems/products }
      - { type: PART_OF, from: component:example/catalog/product-api, to: system:catalog/products, evidence: components/product-api }
      - { type: OWNED_BY, from: component:example/catalog/product-api, to: group:catalog-team, evidence: components/product-api }
      - { type: PROVIDES, from: component:example/catalog/product-api, to: api:product-api/http, evidence: components/product-api }
      - { type: CONSUMES, from: component:example/checkout/checkout-api, to: api:product-api/http, evidence: components/checkout-api }

  - source: k8s-infra                       # a infraestrutura de um cluster
    scope: { cluster: dev }
    evidence: "infra/dev/postgres.yaml"     # a mesma evidência para todos os fatos do retrato
    nodes:
      - { key: env:dev, kind: development, name: dev }
      - { key: resource:dev/postgres, kind: database-server, name: postgres }
      - { key: resource:dev/postgres/products, kind: database, name: products }
    relations:
      - { type: IN_ENVIRONMENT, from: resource:dev/postgres, to: env:dev }
      - { type: RUNS, from: resource:dev/postgres, to: tech:postgresql, version: "16" }
      - { type: HOSTED_ON, from: resource:dev/postgres/products, to: resource:dev/postgres }
      - { type: USES_RESOURCE, from: component:example/catalog/product-api, to: resource:dev/postgres/products, access: read-write }
```

Confira e envie, em `adapters/`:

```sh
docker compose run --rm carga --dry-run   # valida as chaves e as evidências e mostra o resumo, sem enviar
docker compose run --rm carga             # envia; a API valida cada retrato contra o modelo
```

- **Toda afirmação tem evidência:** o `evidence` do item, o do retrato ou o `evidenceBase` (os dois se concatenam). Sem nenhuma, a carga é recusada antes do envio.
- **O tipo vem do prefixo da chave** (`group:` é `Group`). Os demais campos do item são propriedades, e uma propriedade ou um valor fora do modelo recusa o retrato inteiro (`invalid_snapshot`, com a lista dos erros, e saída `2`). Os outros retratos do envio seguem.
- **Uma relação pode apontar para um nó que ninguém declarou** (`tech:postgresql` acima): ele é criado como referenciado, e a ordem das cargas não importa.
- **Cada envio substitui o retrato anterior da mesma fonte e escopo.** Apagar uma linha do arquivo e enviar de novo deixa o fato `stale` (fora das consultas, mas no histórico). Um retrato mais antigo que o último do escopo é recusado (`outdated`).
- **Use as mesmas chaves que os adaptadores.** O componente é `component:<caminho do repositório>` e a API é `api:<serviço>/http`, para que os builds publicados (pelo receptor ou pelo `graph-publish`) caiam nos mesmos nós. As receitas estão no [MODELO.md](api/MODELO.md#receitas-de-chave).

Abra o console e busque `product-api`: a ficha mostra o dono, o consumidor e o banco, e o selo de fontes mostra as três fontes. Quando um adaptador passar a cobrir um assunto, o retrato correspondente sai do YAML (com as listas vazias, enviado uma última vez) e os fatos manuais viram `stale`.

Sem o `graph-seed`, o mesmo retrato vai em JSON para `POST /v1/ingest`: o [ADAPTADOR.md](api/ADAPTADOR.md) mostra o formato e um exemplo de carga para cada relação.

## 6. Autenticação

A instância sobe **anônima**: o console abre sem login, o topo mostra "Anônimo", e quem alcança a API consulta o grafo. Use assim para avaliar ou numa rede de confiança. Para proteger ao menos a escrita, defina um `INGEST_TOKEN` no `.env` (16+ caracteres, ex.: `openssl rand -base64 32`): a ingestão, os apelidos e a união de nós passam a exigi-lo em `Authorization: Bearer`.

### Login pelo SSO da organização

Com `OIDC_ISSUER` definido, o console pede a entrada pelo provedor da organização (Entra ID, Okta, Keycloak, Google, ADFS: qualquer um que fale OIDC), e o REST e o MCP passam a exigir sessão ou token.

1. No provedor, registre um aplicativo web com o retorno `<API_PUBLIC_URL>/v1/auth/callback` (ex.: `https://grafo-api.example.com/v1/auth/callback`) e o logout voltando para o endereço do console. Para os grupos aparecerem, inclua a claim de grupos no ID token.
2. No `.env`, preencha `API_PUBLIC_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` e `SESSION_SECRET` (32+ caracteres, o mesmo em todas as réplicas), e ajuste `OIDC_GROUPS_CLAIM` ao nome que o provedor usa. O [.env.example](.env.example) explica cada uma.
3. Console e API em sites diferentes (domínios registráveis diferentes) pedem `SESSION_COOKIE_SAMESITE=none` e HTTPS.

Para experimentar sem um provedor, suba o Keycloak de exemplo: descomente o bloco "Keycloak de exemplo" do `.env` e rode

```sh
docker compose --profile sso up -d --build
```

Entre no console com `maria`/`maria` (grupo `arquitetura`) ou `joao`/`joao` (`plataforma`). A administração do Keycloak fica em <http://localhost:8180> (`admin`/`admin`).

### Máquinas: adaptadores, CI e clientes MCP

Com o SSO ligado, quem não é pessoa manda `Authorization: Bearer` com:

- o `INGEST_TOKEN`; ou
- um JWT de um emissor listado em `JWT_ISSUERS`, com a audiência `JWT_AUDIENCE` (padrão `panorama-graph`): o próprio provedor, por client credentials, ou o OIDC do CI (no GitLab, um `id_tokens` com `aud: panorama-graph`; no GitHub Actions, o token com essa audiência).

No Keycloak de exemplo, o cliente `panorama-graph` emite um token de serviço:

```sh
TOKEN=$(curl -s -d grant_type=client_credentials -d client_id=panorama-graph -d client_secret=panorama-graph-dev-secret \
  http://localhost:8180/realms/panorama/protocol/openid-connect/token | jq -r .access_token)
claude mcp add --transport http panorama-graph http://localhost:3200/mcp --header "Authorization: Bearer $TOKEN"
```

O SDK manda o token com `new PanoramaGraphClient({ baseUrl, token })`.

## Desenvolver

- **Dependências:** Node.js 22.18+ e pnpm 11 (`corepack enable`, ou `npm install -g pnpm`). `pnpm install` na raiz instala todos os projetos do workspace, com o SDK ligado ao código.
- **API fora do container:** `docker compose up -d neo4j` aqui e, em `api/`, `cp .env.example .env` e `pnpm run dev`.
- **Console fora do container:** em `web/`, `pnpm run dev` (porta 5180).
- **Testes da API:** `pnpm run test:db:up` em `api/` sobe o Neo4j de teste (porta 7688, com o compose de `api/`).

Cada projeto tem o próprio `AGENTS.md`; as regras do repositório estão no [AGENTS.md](AGENTS.md) da raiz.
