# Escrever um adaptador sem o SDK

Para quem vai alimentar o grafo a partir de uma fonte da organização (diretório de pessoas, catálogo, CMDB, inventário da infraestrutura, um build que não é Gradle) numa linguagem sem SDK, ou sem usar o SDK. Em TypeScript, o [SDK](../sdks/typescript/README.md) e o [example-seed](https://github.com/panorama-graph/panorama-graph-adapters/tree/main/example-seed) já fazem o que está aqui. Para uma carga em YAML, sem escrever código, use o [graph-seed](https://github.com/panorama-graph/panorama-graph-adapters#graph-seed).

O contrato é o REST da API: o `POST /v1/ingest` recebe os retratos, e o `GET /v1/schema` descreve o modelo. O OpenAPI (`GET /v1/openapi.json`, também em [contract/openapi-v1.json](contract/openapi-v1.json)) tem o corpo tipado como `Snapshot`. Este documento diz o que o OpenAPI não diz: como montar as chaves, como escolher a fonte e o escopo, como tratar cada resposta e como afirmar cada relação.

## O ciclo de uma carga

1. **Confira o modelo.** `GET /v1/schema` devolve `modelVersion`. Se não for a versão para a qual o adaptador foi escrito, não envie: com versões diferentes, a carga seria recusada ou perderia o que um lado não conhece. Os adaptadores do produto param com erro.
2. **Leia a fonte e monte um retrato por fonte e escopo**, com tudo o que a fonte afirma naquele escopo. O retrato é completo, e não um delta: o que ficar de fora vira `stale`.
3. **Envie** cada retrato em `POST /v1/ingest`, com `content-type: application/json`, até 20 MB por retrato. Para conferir antes, `POST /v1/ingest?dryRun=true` devolve as mesmas recusas e as mesmas contagens, sem gravar nada: o `stale` diz o que a carga de verdade tiraria do retrato atual.
4. **Trate a resposta** pela tabela abaixo, pelo `code` do erro, e não pela mensagem.
5. **Encerre o que deixou de existir.** O que a fonte não vê mais sai do retrato seguinte. Um escopo inteiro que acabou (todos os componentes de um time desativado, um namespace removido) recebe um retrato vazio, com `nodes` e `relations` vazios. Um componente removido, cujas fontes pararam de publicar, é aposentado em todas as fontes de uma vez com `POST /v1/scopes/retire` (veja o [README da API](README.md#ingestão)).

| Resposta | `code` | O que fazer |
|---|---|---|
| `200` | — | Gravado. `counts` traz, para nós e relações, `created`, `updated`, `unchanged` e `stale`, e `referenced`: pontas de relação que ainda não existiam |
| `400` | `invalid_request` | O JSON não tem a forma do `Snapshot` (campo a mais, tipo errado, `observedAt` sem fuso). Erro do adaptador |
| `422` | `invalid_snapshot` | Fora do modelo ou sem evidência. `details.errors` lista cada problema; nada do retrato foi gravado (tudo ou nada). Erro do adaptador |
| `409` | `outdated_snapshot` | A API já tem um retrato mais novo deste escopo. **Não é erro**: este não é gravado, e o adaptador segue para o próximo |
| `413` | `payload_too_large` | Mais de 20 MB. Divida a fonte em escopos menores |
| `5xx` ou falha de rede | — | Envie de novo o mesmo retrato. A carga é idempotente: o mesmo retrato, com o mesmo `observedAt`, é aceito e só dá `unchanged` |

Os erros têm sempre o formato `{ "error", "code", "status", "details" }`. Uma resposta `401` (`unauthorized`) quer dizer que a instância exige autenticação: o adaptador manda `Authorization: Bearer <token>`, com o `INGEST_TOKEN` da instância ou um JWT de um emissor confiável, como o OIDC do CI ([primeiros passos](../PRIMEIROS-PASSOS.md#6-autenticação)). Sem autenticação ligada, não mande o cabeçalho: um token que a instância não reconhece é recusado com `401`.

## O retrato

```json
{
  "source": "directory",
  "scope": { "tenant": "example" },
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "https://directory.example.com/",
  "producer": { "name": "directory-adapter", "version": "1.0.0" },
  "nodes": [
    { "key": "group:catalog-team", "type": "Group", "props": { "name": "Time de Catálogo" }, "evidence": "groups/catalog-team" },
    { "key": "person:maria.silva", "type": "Person", "props": { "name": "Maria Silva", "email": "maria.silva@example.com" }, "evidence": "users/maria.silva" }
  ],
  "relations": [
    { "type": "MEMBER_OF", "from": "person:maria.silva", "to": "group:catalog-team", "props": { "role": "Tech Lead", "lead": true }, "evidence": "users/maria.silva" }
  ]
}
```

| Campo | O que é |
|---|---|
| `source` | O nome da fonte: minúsculas, dígitos e hífen, começando por letra. É o sistema que viu os fatos (`directory`, `cmdb`), e não o programa que os leu |
| `scope` | O recorte que a fonte leu, como objeto de textos (`{ "tenant": "example" }`, `{ "cluster": "prd", "namespace": "catalog" }`). Veja [Fonte e escopo](#fonte-e-escopo) |
| `observedAt` | Quando a fonte foi lida, em ISO 8601 com fuso. Retratos de um escopo precisam chegar em ordem: um mais antigo que o último é recusado (`409`) |
| `evidenceBase` | Opcional. Prefixo comum das evidências: a evidência de cada fato é a sua `evidence` concatenada a ele, ou só uma das duas |
| `producer` | Opcional. O programa que montou o retrato e a versão dele. Aparece no `sources_status`; quem relê a mesma fonte com uma versão que extrai mais sabe que o retrato pode mudar |
| `revision` | Opcional. De que versão de um componente é o retrato (veja [Retrato congelado](#retrato-congelado)) |
| `nodes[]` | `key`, `type`, `props` e `evidence`. O `type` é obrigatório e precisa ser o do prefixo da chave (`group:` é `Group`) |
| `relations[]` | `type`, `from`, `to`, `props` e `evidence`. O par de tipos de `from` e `to` precisa ser um dos pares da relação |

Regras que a API aplica, todas com `422` para o retrato inteiro:

- **Evidência em todo fato:** a do item, a do `evidenceBase` ou as duas concatenadas. A evidência diz onde o fato foi visto, para quem consulta conferir: `repo@sha:caminho`, a URL do registro, o objeto no cluster.
- **Propriedades dentro de `props`**, só as do tipo ([MODELO.md](MODELO.md#nós-relações-e-valores-fixos)), com o tipo e, quando há lista fechada, um dos valores aceitos. Uma propriedade com `null` é ignorada. Os campos de proveniência (`source`, `evidence`, `state`, `status`, `observedAt` e os demais) não podem ser propriedades.
- **Sem `state`:** tudo o que entra pelo `/ingest` é `observed`.
- **Sem repetição:** o mesmo nó duas vezes, ou a mesma relação (mesmo tipo, mesmas pontas e mesmas propriedades de identidade) duas vezes, recusa o retrato.
- **Relação pode apontar para nó que ninguém declarou.** Ele é criado como referenciado, sem afirmação, até alguma fonte declará-lo. A ordem das cargas entre fontes não importa.

Um nó só precisa estar em `nodes` quando a fonte afirma alguma propriedade dele (o nome, o `kind`). Para só ligar, basta a chave na relação.

### Retrato congelado

O retrato da **linha principal** (escopo sem `commit`) é o que as consultas mostram por padrão. Um retrato pode dizer de que commit e versão de um componente ele é, com `revision`:

```json
{ "source": "openapi", "scope": { "component": "example/catalog/product-api" },
  "revision": { "component": "component:example/catalog/product-api", "commit": "4f2a9c1", "version": "1.5.0" }, ... }
```

Com `commit` também no escopo (o mesmo do `revision.commit`), o retrato fica **congelado**: guarda o que aquela versão oferecia e usava, e só aparece no recorte de um ambiente em que o commit está implantado (`DEPLOYED_IN` com o mesmo `commit`). Quem congela é quem vê o commit rodando, não o pipeline. Os detalhes e a retenção estão no [README da API](README.md#versões-linha-principal-e-retrato-congelado).

## Fonte e escopo

**A fonte** é o sistema que viu o fato, e o nome que aparece nas consultas ao lado de cada afirmação. Duas fontes que afirmam a mesma relação geram duas afirmações, lado a lado, e a divergência entre elas fica visível. Use um nome por sistema, estável: trocar o nome é começar outra fonte, e os fatos da antiga só saem quando ela mandar um retrato vazio.

**O escopo** é o recorte que um retrato cobre por inteiro. Cada envio substitui o retrato anterior da mesma fonte e escopo, e só dele. Escolha o escopo pelo que a fonte lê de uma vez:

- **Uma leitura só, de tudo:** um escopo fixo (`{ "tenant": "example" }` para o diretório inteiro).
- **Uma leitura por parte:** um escopo por parte (`{ "cluster", "namespace" }` para um inventário lido namespace a namespace). Uma parte que some precisa de um retrato vazio, ou os fatos dela continuam valendo.
- **Duas cópias da mesma fonte** (duas branches, dois clusters lendo o mesmo namespace) nunca no mesmo escopo: uma troca o retrato da outra a cada envio.

O escopo é livre, mas os pares fonte e escopo dos adaptadores do produto já têm dono. Um adaptador próprio que usar um deles troca os retratos com o adaptador do produto:

| Fonte | Escopo | Quem publica |
|---|---|---|
| `build-manifest`, `sbom`, `dependency-usage`, `openapi`, `asyncapi`, `http-clients`, `data-access`, `pact` | `{ component }`; congelado, `{ component, commit }` | `graph-publish` e `graph-receiver`, a partir dos artefatos do build |
| `k8s-deployments` | `{ cluster, namespace }` | `graph-deployments` |

Outros nomes que a organização de exemplo usa, e que um adaptador próprio pode adotar, estão no [README dos adaptadores](https://github.com/panorama-graph/panorama-graph-adapters#readme): `directory` (`{ tenant }`), `service-catalog` (`{ catalog }`), `service-config` (`{ component, environment }`), `k8s-infra` e `k8s-routes` (`{ cluster, namespace }`).

**Do manual para o adaptador.** Um adaptador que passa a cobrir um assunto carregado à mão substitui o retrato manual se usar a mesma fonte e o mesmo escopo. Com outra fonte ou outro escopo, envie o retrato manual uma última vez, vazio, para os fatos manuais virarem `stale`.

## Receitas de chave

Fontes diferentes só falam do mesmo nó se usarem a mesma chave. O formato é `<prefixo>:<identificador>`, e o prefixo diz o tipo. A API só confere o formato: uma chave fora da receita é aceita e vira outro nó, duplicado. Por isso, sem o SDK, reproduza as receitas exatamente e confira o adaptador contra os casos de [sdks/key-recipes.json](../sdks/key-recipes.json), os mesmos que o SDK em TypeScript usa nos testes.

| Nó | Chave | Regras |
|---|---|---|
| `Component` | `component:<caminho do repositório>` | O caminho como está no servidor git, sem host: `example/catalog/product-api` |
| `Repository` | `repo:<host>/<caminho>` | `repo:git.example.com/example/catalog/product-api` |
| `Api` | `api:<serviço>/http`; versionada, `api:<serviço>/<versão>/http` | `<serviço>` é o nome com que os clientes conhecem o componente (o participante nos pacts), sem a versão do host. A versão é normalizada (abaixo) |
| `Endpoint` | `endpoint:<serviço>/<MÉTODO> <caminho>`; versionada no código, `endpoint:<serviço>/<versão>/<MÉTODO> <caminho>` | Método em maiúsculas e um espaço antes do caminho. O caminho começa com `/`, tem uma barra só entre segmentos, não termina em `/` (menos o `/` sozinho) e cada parâmetro vira `{}`: `products//{productId}/` → `/products/{}` |
| `Topic` | `topic:<endereço do canal>` | O endereço no broker, com a versão que estiver no nome |
| `Contract` | `contract:openapi/<serviço>`, `contract:asyncapi/<serviço>`, `contract:pact/<consumidor>→<provedor>` | A seta é o caractere `→` (U+2192) |
| `Library` | `lib:maven/<grupo>:<artefato>`; outros purls, `lib:<tipo>/<namespace>/<nome>`, ou `lib:<tipo>/<nome>` sem namespace | As coordenadas do purl, sem versão e sem codificação (`%40fastify` é `@fastify`): `lib:npm/@fastify/fastify` |
| `Technology` | `tech:<nome>` | O nome em minúsculas: `tech:spring-boot` |
| `Dataset` | `dataset:<caminho do componente>/<nome>` | Pelo componente que o mapeia, e não pelo banco |
| `Resource` | instância `resource:<ambiente>/<nome>`; recurso lógico `resource:<ambiente>/<instância>/<nome>` | `resource:dev/postgres`, `resource:dev/postgres/catalog` |
| `Environment` | `env:<ambiente>` | O mesmo nome do primeiro segmento da chave do recurso |
| `Domain`, `System`, `Group` | `domain:<id>`, `system:<id>`, `group:<id>` | O identificador curto na fonte |
| `OrgLevel` | `level:<nível>` | O nome do nível na organização: `level:tribo` |
| `Person` | `person:<login>` | O login no diretório |

**Versão de API e tópico.** A versão de uma interface é só a maior, no formato `v<N>`: `1`, `v1` e `V01` são `v1`; `1.2.0` não é versão de interface. A fonte que sabe a versão a declara; sem declaração, valem as convenções:

| Onde | Regra | Exemplo |
|---|---|---|
| Primeiro segmento do caminho (versão no código) | `^/*v(\d+)(/\|$)`, sem diferenciar maiúsculas | `/v1/products` → `v1`; `/products/v1` e `/vendors` → nenhuma |
| Nome do serviço exposto (versão na infraestrutura) | `^(.+)-v(\d+)$` | `product-api-v2` → serviço `product-api`, `v2` |
| Fim do nome do tópico | `[-.]v(\d+)$` | `product-created.v1` → `v1` |

Quando duas chaves para a mesma coisa já existem, não recarregue: registre um apelido (`POST /v1/nodes/{key}/aliases`) ou una os dois nós (`POST /v1/nodes/merge`).

## Relações, uma a uma

Cada relação abaixo tem um retrato de exemplo, pronto para o `POST /v1/ingest`. A fonte e o escopo de cada exemplo são os que a organização de exemplo usa, e as chaves seguem as receitas. Onde o exemplo usa uma fonte dos adaptadores do produto, ele mostra o que eles enviam; o seu adaptador envia com a fonte dele. Os exemplos são conferidos contra o modelo nos testes da API, e esta seção é gerada (`pnpm run adaptador:write`).

<!-- relacoes:inicio -->
### `PART_OF`

Pertence a.

- **Liga:** `System` → `Domain`, `Component` → `System`, `Group` → `Group`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O catálogo de serviços (domínios, sistemas e componentes, fonte `service-catalog`) e o diretório da empresa (a árvore de grupos, fonte `directory`). São fontes diferentes, em retratos diferentes.
- `Group PART_OF Group` é a hierarquia da organização: o filho aponta para o pai, no retrato do diretório, com o nível de cada grupo (veja o exemplo de `AT_LEVEL`).
- Um componente pertence a um sistema só; dois `PART_OF` do mesmo componente na mesma fonte são dois sistemas, e as consultas mostram os dois.

```json
{
  "source": "service-catalog",
  "scope": {"catalog":"example"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "https://catalog.example.com/",
  "nodes": [
    {"key":"domain:catalog","type":"Domain","props":{"name":"Catálogo"},"evidence":"domains/catalog"},
    {"key":"system:catalog/products","type":"System","props":{"name":"Produtos"},"evidence":"systems/catalog-products"},
    {"key":"component:example/catalog/product-api","type":"Component","props":{"name":"product-api","kind":"service"},"evidence":"components/product-api"}
  ],
  "relations": [
    {"type":"PART_OF","from":"system:catalog/products","to":"domain:catalog","evidence":"systems/catalog-products"},
    {"type":"PART_OF","from":"component:example/catalog/product-api","to":"system:catalog/products","evidence":"components/product-api"}
  ]
}
```

### `OWNED_BY`

É de responsabilidade de.

- **Liga:** `Component` → `Group`, `System` → `Group`, `Domain` → `Group`, `Api` → `Group`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O catálogo de serviços (fonte `service-catalog`).
- O dono é um grupo, normalmente um time (o grupo num nível com `team: true`). As consultas sobem a árvore de grupos a partir dele.
- `Api OWNED_BY` só quando a API tem dono diferente do componente que a oferece; sem ela, o dono da API é o do componente.

```json
{
  "source": "service-catalog",
  "scope": {"catalog":"example"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "https://catalog.example.com/",
  "nodes": [],
  "relations": [
    {"type":"OWNED_BY","from":"domain:catalog","to":"group:digital-products","evidence":"domains/catalog"},
    {"type":"OWNED_BY","from":"system:catalog/products","to":"group:catalog-team","evidence":"systems/catalog-products"},
    {"type":"OWNED_BY","from":"component:example/catalog/product-api","to":"group:catalog-team","evidence":"components/product-api"},
    {"type":"OWNED_BY","from":"api:product-api/http","to":"group:catalog-team","evidence":"apis/product-api"}
  ]
}
```

### `MEMBER_OF`

Pessoa é membro do grupo.

- **Liga:** `Person` → `Group`.
- **Propriedades:** `role`, `lead`.
- **Quem afirma:** O diretório da empresa (fonte `directory`, um retrato com todas as pessoas).
- A chave da pessoa é o login no diretório (`person:<login>`): é por ela que o resto da organização a encontra.
- `lead: true` marca quem lidera o grupo; `role` é texto livre, no vocabulário da organização.

```json
{
  "source": "directory",
  "scope": {"tenant":"example"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "https://directory.example.com/",
  "nodes": [
    {"key":"person:maria.silva","type":"Person","props":{"name":"Maria Silva","email":"maria.silva@example.com"},"evidence":"users/maria.silva"}
  ],
  "relations": [
    {"type":"MEMBER_OF","from":"person:maria.silva","to":"group:catalog-team","props":{"role":"Tech Lead","lead":true},"evidence":"users/maria.silva"}
  ]
}
```

### `AT_LEVEL`

Grupo está no nível da estrutura organizacional.

- **Liga:** `Group` → `OrgLevel`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O diretório da empresa (fonte `directory`), no mesmo retrato dos grupos.
- Os níveis são nós com o nome que a organização usa. `order` é a posição de cima para baixo (1 é o topo) e `team: true` marca os níveis cujos grupos são times.
- A hierarquia é a do `PART_OF` entre grupos, nunca a do `order`: um time pode ficar direto sob a diretoria.

```json
{
  "source": "directory",
  "scope": {"tenant":"example"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "https://directory.example.com/",
  "nodes": [
    {"key":"level:diretoria","type":"OrgLevel","props":{"name":"Diretoria","order":1},"evidence":"levels/diretoria"},
    {"key":"level:time","type":"OrgLevel","props":{"name":"Time","order":2,"team":true},"evidence":"levels/time"},
    {"key":"group:digital-products","type":"Group","props":{"name":"Produtos Digitais"},"evidence":"groups/digital-products"},
    {"key":"group:catalog-team","type":"Group","props":{"name":"Time de Catálogo"},"evidence":"groups/catalog-team"}
  ],
  "relations": [
    {"type":"AT_LEVEL","from":"group:digital-products","to":"level:diretoria","evidence":"groups/digital-products"},
    {"type":"AT_LEVEL","from":"group:catalog-team","to":"level:time","evidence":"groups/catalog-team"},
    {"type":"PART_OF","from":"group:catalog-team","to":"group:digital-products","evidence":"groups/catalog-team"}
  ]
}
```

### `HOSTED_IN`

Código do componente está no repositório.

- **Liga:** `Component` → `Repository`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O build de cada componente (fonte `build-manifest`, escopo `{component}`) ou o catálogo, para componentes que não publicam build.
- A chave do componente é o caminho do repositório, e a do repositório leva o host: `repo:<host>/<caminho>`.

```json
{
  "source": "build-manifest",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "nodes": [
    {"key":"repo:git.example.com/example/catalog/product-api","type":"Repository","props":{"url":"https://git.example.com/example/catalog/product-api"},"evidence":"example/catalog/product-api@4f2a9c1:build/architecture/manifest.json"}
  ],
  "relations": [
    {"type":"HOSTED_IN","from":"component:example/catalog/product-api","to":"repo:git.example.com/example/catalog/product-api","evidence":"example/catalog/product-api@4f2a9c1:build/architecture/manifest.json"}
  ]
}
```

### `PROVIDES`

Componente oferece a API.

- **Liga:** `Component` → `Api`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O contrato que o próprio componente gera (fonte `openapi`, escopo `{component}`) e, para a versão exposta na infraestrutura, quem lê a implantação (veja `VERSION_OF`).
- A API é nomeada pelo **nome de serviço**, o nome com que os clientes conhecem o componente (o participante nos pacts), e não pelo caminho do repositório: `api:product-api/http`. É assim que provedor e consumidores chegam à mesma chave.
- Vem no mesmo retrato que os endpoints (`HAS_ENDPOINT`) e o contrato (`SPECIFIED_BY`).

```json
{
  "source": "openapi",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:",
  "nodes": [
    {"key":"api:product-api/http","type":"Api","props":{"name":"Product API","kind":"http"},"evidence":"src/main/java/com/example/catalog/ProductController.java"}
  ],
  "relations": [
    {"type":"PROVIDES","from":"component:example/catalog/product-api","to":"api:product-api/http","evidence":"src/main/java/com/example/catalog/ProductController.java"}
  ]
}
```

### `HAS_ENDPOINT`

API tem a operação.

- **Liga:** `Api` → `Endpoint`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O contrato da API (fonte `openapi`), no retrato do `PROVIDES`.
- A chave do endpoint leva o caminho com os parâmetros anônimos (`/products/{}`); o caminho original, com os nomes, vai na propriedade `path`.
- `contract` é opcional: o JSON da operação (parâmetros, corpo, respostas e os `$ref` locais em `components`), lido pelo `contract_get`.

```json
{
  "source": "openapi",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:",
  "nodes": [
    {"key":"endpoint:product-api/GET /products/{}","type":"Endpoint","props":{"name":"GET /products/{id}","method":"GET","path":"/products/{id}","operationId":"getProduct"},"evidence":"src/main/java/com/example/catalog/ProductController.java#getProduct"}
  ],
  "relations": [
    {"type":"HAS_ENDPOINT","from":"api:product-api/http","to":"endpoint:product-api/GET /products/{}","evidence":"src/main/java/com/example/catalog/ProductController.java#getProduct"}
  ]
}
```

### `CONSUMES`

Componente consome a API.

- **Liga:** `Component` → `Api`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O consumidor: os clientes HTTP declarados no código (fonte `http-clients`) e os pacts (fonte `pact`), cada um no escopo `{component}` do consumidor.
- Afirme `CONSUMES` sempre que afirmar `CALLS`: as perguntas de dependência (`component_dependencies`, `architecture_overview`) andam por `CONSUMES`, e `CALLS` diz quais operações.
- O consumidor de uma versão exposta na infraestrutura (`product-api-v2.example.com`) consome a API daquela versão, `api:product-api/v2/http`.

```json
{
  "source": "http-clients",
  "scope": {"component":"example/checkout/checkout-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/checkout/checkout-api@9b1e0d7:",
  "nodes": [],
  "relations": [
    {"type":"CONSUMES","from":"component:example/checkout/checkout-api","to":"api:product-api/http","evidence":"src/main/java/com/example/checkout/catalog/CatalogClient.java"}
  ]
}
```

### `CALLS`

Componente chama a operação.

- **Liga:** `Component` → `Endpoint`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O consumidor, no retrato do `CONSUMES` (fontes `http-clients` e `pact`).
- O endpoint chamado tem a chave do provedor: o nome de serviço do provedor, o método e o caminho com os parâmetros anônimos. O consumidor não precisa saber como o provedor nomeia os parâmetros.
- Numa API versionada na infraestrutura, o cliente chama os endpoints do código, sem a versão do host (`endpoint:product-api/GET /products/{}`).

```json
{
  "source": "http-clients",
  "scope": {"component":"example/checkout/checkout-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/checkout/checkout-api@9b1e0d7:",
  "nodes": [],
  "relations": [
    {"type":"CONSUMES","from":"component:example/checkout/checkout-api","to":"api:product-api/http","evidence":"src/main/java/com/example/checkout/catalog/CatalogClient.java"},
    {"type":"CALLS","from":"component:example/checkout/checkout-api","to":"endpoint:product-api/GET /products/{}","evidence":"src/main/java/com/example/checkout/catalog/CatalogClient.java#getProduct"}
  ]
}
```

### `PUBLISHES`

Componente publica no tópico.

- **Liga:** `Component` → `Topic`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O contrato de eventos do componente (fonte `asyncapi`, escopo `{component}`).
- O tópico é identificado pelo endereço no broker; a versão, quando há, já está no nome (`catalog.product-created.v1`) e vai também em `version`.
- Quem publica e quem assina chegam ao mesmo nó pela mesma chave, sem combinar nada além do endereço.

```json
{
  "source": "asyncapi",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:",
  "nodes": [
    {"key":"topic:catalog.product-created.v1","type":"Topic","props":{"name":"catalog.product-created.v1","kind":"topic","version":"v1"},"evidence":"build/architecture/asyncapi.json#/channels/productCreated"}
  ],
  "relations": [
    {"type":"PUBLISHES","from":"component:example/catalog/product-api","to":"topic:catalog.product-created.v1","evidence":"src/main/java/com/example/catalog/ProductEvents.java#publishCreated"}
  ]
}
```

### `SUBSCRIBES`

Componente consome do tópico.

- **Liga:** `Component` → `Topic`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O contrato de eventos do consumidor (fonte `asyncapi`, escopo `{component}` dele).
- Uma fila (`kind: queue`) é um `Topic` também: quem lê dela assina com `SUBSCRIBES`.

```json
{
  "source": "asyncapi",
  "scope": {"component":"example/checkout/checkout-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/checkout/checkout-api@9b1e0d7:",
  "nodes": [],
  "relations": [
    {"type":"SUBSCRIBES","from":"component:example/checkout/checkout-api","to":"topic:catalog.product-created.v1","evidence":"src/main/java/com/example/checkout/catalog/ProductCreatedListener.java"}
  ]
}
```

### `VERSION_OF`

API versionada na infraestrutura (o serviço exposto com a versão no nome, servico-xpto-v2) é a API do código implantada sob esse nome: os endpoints são os da API do código.

- **Liga:** `Api` → `Api`.
- **Propriedades:** nenhuma.
- **Quem afirma:** Quem lê a implantação (fonte `k8s-deployments`, escopo `{cluster, namespace}`): o serviço exposto com a versão no nome (`product-api-v2`) e cujo seletor casa com os pods do componente.
- Só para o versionamento na infraestrutura. Vai junto com o `PROVIDES` da API versionada, e a API versionada não tem endpoints próprios: `api_consumers` chega aos do código pelo `VERSION_OF`.
- No versionamento no código (`/v1/products`), cada versão é uma API com os próprios endpoints, publicada pelo contrato, e não há `VERSION_OF`.

```json
{
  "source": "k8s-deployments",
  "scope": {"cluster":"example","namespace":"catalog-dev"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "k8s://example/catalog-dev/",
  "nodes": [
    {"key":"api:product-api/v2/http","type":"Api","props":{"name":"product-api-v2","kind":"http","version":"v2"},"evidence":"services/product-api-v2"}
  ],
  "relations": [
    {"type":"PROVIDES","from":"component:example/catalog/product-api","to":"api:product-api/v2/http","evidence":"services/product-api-v2"},
    {"type":"VERSION_OF","from":"api:product-api/v2/http","to":"api:product-api/http","evidence":"services/product-api-v2"}
  ]
}
```

### `SPECIFIED_BY`

Especificado pelo contrato.

- **Liga:** `Api` → `Contract`, `Topic` → `Contract`.
- **Propriedades:** nenhuma.
- **Quem afirma:** Quem lê o contrato: `openapi` e `asyncapi` no escopo do provedor, `pact` no escopo do consumidor.
- O contrato é um nó (`Contract`) com `kind` e, quando está publicado, `url`. A evidência aponta para o documento.
- As chaves: `contract:openapi/<serviço>`, `contract:asyncapi/<serviço>` e `contract:pact/<consumidor>→<provedor>`.

```json
{
  "source": "openapi",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:",
  "nodes": [
    {"key":"contract:openapi/product-api","type":"Contract","props":{"name":"product-api (OpenAPI)","kind":"openapi"},"evidence":"build/architecture/openapi.json"},
    {"key":"contract:asyncapi/product-api","type":"Contract","props":{"name":"product-api (AsyncAPI)","kind":"asyncapi"},"evidence":"build/architecture/asyncapi.json"}
  ],
  "relations": [
    {"type":"SPECIFIED_BY","from":"api:product-api/http","to":"contract:openapi/product-api","evidence":"build/architecture/openapi.json"},
    {"type":"SPECIFIED_BY","from":"topic:catalog.product-created.v1","to":"contract:asyncapi/product-api","evidence":"build/architecture/asyncapi.json#/channels/productCreated"}
  ]
}
```

### `USES_RESOURCE`

Componente usa o recurso.

- **Liga:** `Component` → `Resource`.
- **Propriedades:** `access`.
- **Quem afirma:** A configuração de implantação de cada serviço (fonte `service-config`, escopo `{component, environment}`): um retrato por componente e ambiente.
- O alvo costuma ser o recurso lógico (o banco, o bucket), `resource:<ambiente>/<instância>/<nome>`, que fica na instância por `HOSTED_ON`.
- `access` é `read`, `write` ou `read-write`. O que o código lê e escreve, tabela a tabela, é `READS`/`WRITES` em `Dataset`.

```json
{
  "source": "service-config",
  "scope": {"component":"example/catalog/product-api","environment":"dev"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:deploy/values-dev.yaml",
  "nodes": [],
  "relations": [
    {"type":"USES_RESOURCE","from":"component:example/catalog/product-api","to":"resource:dev/postgres/catalog","props":{"access":"read-write"},"evidence":"#database"}
  ]
}
```

### `HOSTED_ON`

Recurso lógico está na instância; tópico está no broker.

- **Liga:** `Resource` → `Resource`, `Topic` → `Resource`.
- **Propriedades:** nenhuma.
- **Quem afirma:** A configuração de implantação (fonte `service-config`) ou o inventário da infraestrutura (fonte `k8s-infra`): o banco na instância e o tópico no broker.
- Os dois pares: `Resource → Resource` (o recurso lógico na instância) e `Topic → Resource` (o tópico no broker).

```json
{
  "source": "service-config",
  "scope": {"component":"example/catalog/product-api","environment":"dev"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:deploy/values-dev.yaml",
  "nodes": [
    {"key":"resource:dev/postgres/catalog","type":"Resource","props":{"name":"catalog","kind":"database"},"evidence":"#database"}
  ],
  "relations": [
    {"type":"HOSTED_ON","from":"resource:dev/postgres/catalog","to":"resource:dev/postgres","evidence":"#database.host"},
    {"type":"HOSTED_ON","from":"topic:catalog.product-created.v1","to":"resource:dev/kafka","evidence":"#kafka.bootstrapServers"}
  ]
}
```

### `INSTANCE_OF`

Instância é a implantação, num ambiente, do componente de infraestrutura.

- **Liga:** `Resource` → `Component`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O inventário da infraestrutura de cada ambiente (fonte `k8s-infra`, escopo `{cluster, namespace}`).
- Liga a instância de um ambiente ao componente de infraestrutura do catálogo (`Component` com `kind: infra`), que tem dono e repositório como qualquer componente.

```json
{
  "source": "k8s-infra",
  "scope": {"cluster":"example","namespace":"catalog-dev"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "k8s://example/catalog-dev/",
  "nodes": [],
  "relations": [
    {"type":"INSTANCE_OF","from":"resource:dev/postgres","to":"component:example/platform/postgres","evidence":"statefulsets/postgres#spec.selector.matchLabels.app"}
  ]
}
```

### `IN_ENVIRONMENT`

Recurso está no ambiente: a instância, ou o recurso lógico quando a fonte o afirma direto.

- **Liga:** `Resource` → `Environment`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O inventário da infraestrutura (fonte `k8s-infra`, escopo `{cluster, namespace}`).
- O nome do ambiente é livre e o mesmo do primeiro segmento da chave do recurso (`resource:dev/...` está em `env:dev`); o `kind` é o estágio fixo (`development`, `test`, `staging`, `production`).
- Afirme na instância; no recurso lógico, só quando a fonte o vê direto no ambiente, sem a instância.

```json
{
  "source": "k8s-infra",
  "scope": {"cluster":"example","namespace":"catalog-dev"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "k8s://example/catalog-dev/",
  "nodes": [
    {"key":"env:dev","type":"Environment","props":{"name":"dev","kind":"development"},"evidence":"namespaces/catalog-dev"},
    {"key":"resource:dev/postgres","type":"Resource","props":{"name":"postgres","kind":"database-server"},"evidence":"statefulsets/postgres"}
  ],
  "relations": [
    {"type":"IN_ENVIRONMENT","from":"resource:dev/postgres","to":"env:dev","evidence":"statefulsets/postgres"}
  ]
}
```

### `DEPLOYED_IN`

Componente está implantado no ambiente, numa versão. Uma afirmação por commit em execução (duas no canário ou no blue-green).

- **Liga:** `Component` → `Environment`.
- **Propriedades:** `version` (obrigatória), `commit` (identidade, obrigatória), `image`, `replicas`.
- **Quem afirma:** Quem vê o que roda (fonte `k8s-deployments`, escopo `{cluster, namespace}`): um retrato por ambiente, com todas as implantações dele.
- `version` e `commit` são obrigatórios, e o `commit` é identidade: no canário ou no blue-green, são duas afirmações, uma por commit em execução.
- A implantação que sai do ambiente some do retrato seguinte e vira `stale`: é o histórico de deploys.
- Para o recorte do ambiente mostrar o que aquela versão oferecia e usava, quem vê o commit rodando publica também o retrato congelado dele (escopo com `commit` e `revision`, veja [Retrato congelado](#retrato-congelado)). Sem ele, o componente aparece no ambiente com o retrato da linha principal.

```json
{
  "source": "k8s-deployments",
  "scope": {"cluster":"example","namespace":"catalog-dev"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "k8s://example/catalog-dev/",
  "nodes": [
    {"key":"env:dev","type":"Environment","props":{"name":"dev","kind":"development"},"evidence":"namespace/catalog-dev"}
  ],
  "relations": [
    {"type":"DEPLOYED_IN","from":"component:example/catalog/product-api","to":"env:dev","props":{"version":"1.5.0","commit":"4f2a9c1","image":"registry.example.com/product-api:1.5.0","replicas":"2"},"evidence":"deployments/product-api"}
  ]
}
```

### `RUNS`

Instância roda a tecnologia.

- **Liga:** `Resource` → `Technology`.
- **Propriedades:** `version`.
- **Quem afirma:** O inventário da infraestrutura (fonte `k8s-infra`): a tecnologia e a versão de cada instância.
- O motor do banco (PostgreSQL, MongoDB) é `RUNS` da instância, e não propriedade do banco ou do dataset.

```json
{
  "source": "k8s-infra",
  "scope": {"cluster":"example","namespace":"catalog-dev"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "k8s://example/catalog-dev/",
  "nodes": [],
  "relations": [
    {"type":"RUNS","from":"resource:dev/postgres","to":"tech:postgresql","props":{"version":"16"},"evidence":"statefulsets/postgres#spec.template.spec.containers[0].image"}
  ]
}
```

### `ROUTES`

Gateway ou ingress encaminha para o componente.

- **Liga:** `Resource` → `Component`.
- **Propriedades:** `host` (identidade, obrigatória), `path` (identidade).
- **Quem afirma:** As regras de roteamento do ambiente (fonte `k8s-routes`, escopo `{cluster, namespace}`): ingress, gateway ou service mesh.
- `host` é obrigatório; `host` e `path` são identidade, então duas rotas do mesmo ingress para o mesmo componente são duas afirmações.
- É o caminho de rede, e não dependência: quem depende de quem continua em `CONSUMES`, e o gateway no meio não esconde o consumidor.

```json
{
  "source": "k8s-routes",
  "scope": {"cluster":"example","namespace":"catalog-dev"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "k8s://example/catalog-dev/ingresses/",
  "nodes": [],
  "relations": [
    {"type":"ROUTES","from":"resource:dev/ingress","to":"component:example/catalog/product-api","props":{"host":"product-api.dev.example.com"},"evidence":"product-api"},
    {"type":"ROUTES","from":"resource:dev/ingress","to":"component:example/catalog/product-api","props":{"host":"api.dev.example.com","path":"/catalog"},"evidence":"public-api"}
  ]
}
```

### `REACHES_VIA`

Componente chega a outros pelo gateway ou ingress.

- **Liga:** `Component` → `Resource`.
- **Propriedades:** nenhuma.
- **Quem afirma:** A configuração do consumidor que aponta para o gateway (fonte `service-config`). Nenhum adaptador do produto afirma esta relação: vem de um adaptador próprio ou da carga à mão.
- Completa `ROUTES`: o consumidor chega ao gateway, e o gateway encaminha ao provedor. A dependência continua em `CONSUMES`.

```json
{
  "source": "service-config",
  "scope": {"component":"example/checkout/checkout-api","environment":"dev"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/checkout/checkout-api@9b1e0d7:deploy/values-dev.yaml",
  "nodes": [],
  "relations": [
    {"type":"REACHES_VIA","from":"component:example/checkout/checkout-api","to":"resource:dev/ingress","evidence":"#catalog.baseUrl"}
  ]
}
```

### `BUILT_WITH`

Componente é construído com a tecnologia.

- **Liga:** `Component` → `Technology`.
- **Propriedades:** `version`.
- **Quem afirma:** O build de cada componente (fonte `build-manifest`, escopo `{component}`).
- A tecnologia vai em minúsculas (`tech:spring-boot`), e a versão é a que o build usou.

```json
{
  "source": "build-manifest",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:build/architecture/manifest.json",
  "nodes": [],
  "relations": [
    {"type":"BUILT_WITH","from":"component:example/catalog/product-api","to":"tech:java","props":{"version":"25"},"evidence":"#/component/technologies/0"},
    {"type":"BUILT_WITH","from":"component:example/catalog/product-api","to":"tech:spring-boot","props":{"version":"4.0.1"},"evidence":"#/component/technologies/1"}
  ]
}
```

### `DEPENDS_ON`

Componente depende da biblioteca.

- **Liga:** `Component` → `Library`.
- **Propriedades:** `version`, `scope`, `resolved`, `direct`, `via`, `declared`, `used`.
- **Quem afirma:** O SBOM do build (fonte `sbom`: `version`, `scope`, `resolved`, `direct`, `via`) e a análise de uso das dependências (fonte `dependency-usage`: `declared`, `used`), cada um no escopo `{component}`.
- A biblioteca é identificada sem versão (`lib:maven/<grupo>:<artefato>`); a versão é da relação, e duas fontes podem divergir nela.
- Na transitiva, `direct: false` e `via` com as chaves das dependências diretas que a trazem.
- `scope` é o classpath (`compile`, `runtime`, `test`), e não a configuração do build em que a dependência é declarada (`implementation`, `api`).

```json
{
  "source": "sbom",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:build/architecture/bom.json",
  "nodes": [],
  "relations": [
    {"type":"DEPENDS_ON","from":"component:example/catalog/product-api","to":"lib:maven/org.springframework.boot:spring-boot-starter-web","props":{"version":"4.0.1","scope":"runtime","resolved":true,"direct":true},"evidence":"#pkg:maven/org.springframework.boot/spring-boot-starter-web@4.0.1"},
    {"type":"DEPENDS_ON","from":"component:example/catalog/product-api","to":"lib:maven/com.fasterxml.jackson.core:jackson-databind","props":{"version":"2.20.0","scope":"runtime","resolved":true,"direct":false,"via":["lib:maven/org.springframework.boot:spring-boot-starter-web"]},"evidence":"#pkg:maven/com.fasterxml.jackson.core/jackson-databind@2.20.0"}
  ]
}
```

### `PRODUCES`

O build do componente gera a biblioteca: o pacote que os outros componentes usam (DEPENDS_ON) sai deste repositório.

- **Liga:** `Component` → `Library`.
- **Propriedades:** `version`.
- **Quem afirma:** O build do componente que gera a biblioteca (fonte `build-manifest`, escopo `{component}`).
- Liga o repositório de uma biblioteca interna aos usos dela: `library_usage` parte do componente e chega a quem tem `DEPENDS_ON` para os pacotes que ele produz.

```json
{
  "source": "build-manifest",
  "scope": {"component":"example/platform/commons"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/platform/commons@71c0e2a:build/architecture/manifest.json",
  "nodes": [],
  "relations": [
    {"type":"PRODUCES","from":"component:example/platform/commons","to":"lib:maven/com.example:commons-web","props":{"version":"3.2.0"},"evidence":"#/component/libraries/0"}
  ]
}
```

### `OWNS_DATA`

Componente define a estrutura do dataset (mapeamento ou migração).

- **Liga:** `Component` → `Dataset`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O acesso a dados lido do código (fonte `data-access`, escopo `{component}`).
- O dataset é identificado pelo componente que o mapeia: `dataset:<caminho do componente>/<nome>`. O build não sabe em que banco de cada ambiente ele está.
- `OWNS_DATA` é de quem define a estrutura (o mapeamento ou a migração); quem só lê ou escreve tem `READS`/`WRITES`.

```json
{
  "source": "data-access",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:",
  "nodes": [
    {"key":"dataset:example/catalog/product-api/products","type":"Dataset","props":{"name":"products","kind":"table","store":"relational"},"evidence":"src/main/java/com/example/catalog/ProductEntity.java"}
  ],
  "relations": [
    {"type":"OWNS_DATA","from":"component:example/catalog/product-api","to":"dataset:example/catalog/product-api/products","evidence":"src/main/java/com/example/catalog/ProductEntity.java"}
  ]
}
```

### `READS`

Componente lê o dataset.

- **Liga:** `Component` → `Dataset`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O acesso a dados lido do código (fonte `data-access`), no mesmo retrato do `OWNS_DATA`.
- A evidência é o ponto do código que faz a leitura, com a linha quando houver.

```json
{
  "source": "data-access",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:",
  "nodes": [],
  "relations": [
    {"type":"READS","from":"component:example/catalog/product-api","to":"dataset:example/catalog/product-api/products","evidence":"src/main/java/com/example/catalog/ProductService.java:24"}
  ]
}
```

### `WRITES`

Componente escreve no dataset.

- **Liga:** `Component` → `Dataset`.
- **Propriedades:** nenhuma.
- **Quem afirma:** O acesso a dados lido do código (fonte `data-access`), no mesmo retrato do `OWNS_DATA`.
- Leitura e escrita do mesmo dataset são duas relações, `READS` e `WRITES`.

```json
{
  "source": "data-access",
  "scope": {"component":"example/catalog/product-api"},
  "observedAt": "2026-10-01T12:00:00Z",
  "evidenceBase": "example/catalog/product-api@4f2a9c1:",
  "nodes": [],
  "relations": [
    {"type":"WRITES","from":"component:example/catalog/product-api","to":"dataset:example/catalog/product-api/products","evidence":"src/main/java/com/example/catalog/ProductService.java:41"}
  ]
}
```
<!-- relacoes:fim -->

## Conferir

| O quê | Como |
|---|---|
| As chaves | Os casos de [sdks/key-recipes.json](../sdks/key-recipes.json) passam no adaptador |
| O retrato contra o modelo | Envie a uma instância local (a do [docker-compose.yml](../docker-compose.yml)): o `422` lista todos os problemas de uma vez |
| A carga é estável | Envie o mesmo retrato duas vezes: a segunda só tem `unchanged` |
| As chaves batem com as das outras fontes | No console, a ficha do componente mostra as fontes de cada relação. Um nó duplicado aparece na busca com as duas chaves |
| As fontes e os escopos | `sources_status` (MCP ou `POST /v1/queries/sources_status`) mostra cada fonte, escopo, `producer` e a última carga |
