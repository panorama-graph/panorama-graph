# Modelo do grafo

O que o grafo guarda, o que é fixo e o que é livre, e o que fazer quando algo da sua organização não cabe no modelo. Para carregar os dados, veja [Carregar a sua organização](../PRIMEIROS-PASSOS.md#5-carregar-a-sua-organização) nos primeiros passos.

O modelo é o mesmo que a API serve em `GET /v1/schema`, e as tabelas abaixo são geradas dele.

## Como os fatos são guardados

- **Nó:** uma coisa da organização (um componente, um time, um banco), identificada por uma chave `<prefixo>:<identificador>`. O prefixo diz o tipo: `component:example/catalog/product-api` é um `Component`.
- **Relação:** um fato entre dois nós (`component:... OWNED_BY group:...`). Só existem os tipos de relação da tabela, e cada um só entre os pares de tipos de nó listados.
- **Afirmação:** cada nó e cada relação é afirmado por uma **fonte** (`source`, o sistema que viu o fato) num **escopo** (`scope`, o recorte que ela leu), com uma evidência e a data. Duas fontes que afirmam a mesma relação geram duas afirmações, lado a lado; quando discordam, as duas aparecem.
- **Retrato:** a fonte manda tudo o que viu num escopo de uma vez. O que ela afirmava antes no mesmo escopo e não afirma mais vira `stale`, e continua consultável como histórico.

Um valor que duas fontes podem afirmar diferente (o dono, a versão do framework, a stack) é relação, e não propriedade do nó, para que a divergência apareça em vez de uma fonte sobrescrever a outra. As propriedades do nó ficam com o nome, a descrição e o subtipo (`kind`).

## Nós, relações e valores fixos

<!-- modelo:inicio -->
Modelo versão **12**. Formato da chave: `<prefixo>:<identificador>`.

### Nós

| Tipo | Prefixo | O que é | Propriedades |
|---|---|---|---|
| `Domain` | `domain:` | Domínio de negócio | `name`, `description` |
| `System` | `system:` | Conjunto de componentes que entregam uma capacidade | `name`, `description` |
| `Component` | `component:` | Unidade implantável | `name`, `description`, `kind` |
| `Repository` | `repo:` | Repositório de código | `name`, `description`, `url` |
| `Api` | `api:` | Interface oferecida. Duas versões que convivem (v1 e v2) são duas APIs | `name`, `description`, `kind`, `version` |
| `Endpoint` | `endpoint:` | Operação de uma API HTTP | `name`, `description`, `method`, `path`, `operationId`, `contract` |
| `Topic` | `topic:` | Canal de eventos: tópico (cada assinante recebe todas as mensagens) ou fila (cada mensagem vai para um só consumidor). Cada versão é um canal, com o próprio nome | `name`, `description`, `kind`, `version` |
| `Contract` | `contract:` | Especificação ou contrato | `name`, `description`, `kind`, `url` |
| `Resource` | `resource:` | Infraestrutura: instância (servidor, broker, gateway) ou recurso lógico (banco, bucket) | `name`, `description`, `kind` |
| `Group` | `group:` | Time ou unidade organizacional | `name`, `description` |
| `OrgLevel` | `level:` | Nível da estrutura organizacional, no vocabulário da organização (diretoria, tribo, time). Cada grupo diz o seu nível por AT_LEVEL | `name`, `description`, `order`, `team` |
| `Person` | `person:` | Pessoa | `name`, `description`, `email` |
| `Technology` | `tech:` | Linguagem, runtime ou framework | `name`, `description` |
| `Library` | `lib:` | Pacote de dependência (coordenadas sem versão) | `name`, `description` |
| `Dataset` | `dataset:` | Estrutura de dados (coleção, tabela, visão), identificada pelo componente que a mapeia | `name`, `description`, `kind`, `store` |
| `Environment` | `env:` | Ambiente em que a infraestrutura e os componentes estão implantados (desenvolvimento, homologação, produção) | `name`, `description`, `kind` |

### Relações

| Relação | De → para | O que é | Natureza | Propriedades |
|---|---|---|---|---|
| `PART_OF` | System → Domain<br>Component → System<br>Group → Group | Pertence a | estrutura | — |
| `OWNED_BY` | Component → Group<br>System → Group<br>Domain → Group<br>Api → Group | É de responsabilidade de | organização | — |
| `MEMBER_OF` | Person → Group | Pessoa é membro do grupo | organização | `role`, `lead` |
| `AT_LEVEL` | Group → OrgLevel | Grupo está no nível da estrutura organizacional | organização | — |
| `HOSTED_IN` | Component → Repository | Código do componente está no repositório | estrutura | — |
| `PROVIDES` | Component → Api | Componente oferece a API | lógica | — |
| `HAS_ENDPOINT` | Api → Endpoint | API tem a operação | estrutura | — |
| `CONSUMES` | Component → Api | Componente consome a API | lógica | — |
| `CALLS` | Component → Endpoint | Componente chama a operação | lógica | — |
| `PUBLISHES` | Component → Topic | Componente publica no tópico | lógica | — |
| `SUBSCRIBES` | Component → Topic | Componente consome do tópico | lógica | — |
| `VERSION_OF` | Api → Api | API versionada na infraestrutura (o serviço exposto com a versão no nome, servico-xpto-v2) é a API do código implantada sob esse nome: os endpoints são os da API do código | física | — |
| `SPECIFIED_BY` | Api → Contract<br>Topic → Contract | Especificado pelo contrato | contrato | — |
| `USES_RESOURCE` | Component → Resource | Componente usa o recurso | lógica | `access` |
| `HOSTED_ON` | Resource → Resource<br>Topic → Resource | Recurso lógico está na instância; tópico está no broker | física | — |
| `INSTANCE_OF` | Resource → Component | Instância é a implantação, num ambiente, do componente de infraestrutura | física | — |
| `IN_ENVIRONMENT` | Resource → Environment | Recurso está no ambiente: a instância, ou o recurso lógico quando a fonte o afirma direto | física | — |
| `DEPLOYED_IN` | Component → Environment | Componente está implantado no ambiente, numa versão. Uma afirmação por commit em execução (duas no canário ou no blue-green) | física | `version` (obrigatória), `commit` (identidade, obrigatória), `image`, `replicas` |
| `RUNS` | Resource → Technology | Instância roda a tecnologia | stack | `version` |
| `ROUTES` | Resource → Component | Gateway ou ingress encaminha para o componente | física | `host` (identidade, obrigatória), `path` (identidade) |
| `REACHES_VIA` | Component → Resource | Componente chega a outros pelo gateway ou ingress | física | — |
| `BUILT_WITH` | Component → Technology | Componente é construído com a tecnologia | stack | `version` |
| `DEPENDS_ON` | Component → Library | Componente depende da biblioteca | stack | `version`, `scope`, `resolved`, `direct`, `via`, `declared`, `used` |
| `PRODUCES` | Component → Library | O build do componente gera a biblioteca: o pacote que os outros componentes usam (DEPENDS_ON) sai deste repositório | stack | `version` |
| `OWNS_DATA` | Component → Dataset | Componente define a estrutura do dataset (mapeamento ou migração) | dados | — |
| `READS` | Component → Dataset | Componente lê o dataset | dados | — |
| `WRITES` | Component → Dataset | Componente escreve no dataset | dados | — |

| Propriedade de relação | O que é |
|---|---|
| `MEMBER_OF.role` | Papel no grupo (string) |
| `MEMBER_OF.lead` | Lidera o grupo (boolean) |
| `USES_RESOURCE.access` | Tipo de acesso (string) |
| `DEPLOYED_IN.version` | Versão do artefato em execução (rótulo, ex.: 1.4.0 ou 1.5.0-RC.2) (string) |
| `DEPLOYED_IN.commit` | Commit de que o artefato em execução foi construído (string) |
| `DEPLOYED_IN.image` | Imagem em execução (string) |
| `DEPLOYED_IN.replicas` | Réplicas pedidas (string) |
| `RUNS.version` | Versão (string) |
| `ROUTES.host` | Host da rota (string) |
| `ROUTES.path` | Prefixo de caminho da rota (string) |
| `BUILT_WITH.version` | Versão (string) |
| `DEPENDS_ON.version` | Versão (string) |
| `DEPENDS_ON.scope` | Escopo da dependência (compile, runtime, test...) (string) |
| `DEPENDS_ON.resolved` | Versão resolvida pelo build (e não só declarada) (boolean) |
| `DEPENDS_ON.direct` | Dependência direta do componente (false: só chega por outra) (boolean) |
| `DEPENDS_ON.via` | Na transitiva: as dependências diretas (chaves de biblioteca) que a trazem para o componente (string[]) |
| `DEPENDS_ON.declared` | Declarada no build do componente (boolean) |
| `DEPENDS_ON.used` | Usada pelo código do componente (análise do bytecode) (boolean) |
| `PRODUCES.version` | Versão do pacote gerada no build afirmado (string) |

Uma propriedade de **identidade** distingue duas afirmações da mesma fonte entre os mesmos nós (ex.: duas rotas do mesmo ingress para o mesmo componente, com `host` diferente). As demais podem divergir entre fontes e ficam em cada afirmação.

### Valores fixos

| Onde | Valores aceitos |
|---|---|
| `Component.kind` | `service`, `bff`, `frontend`, `job`, `library`, `infra` |
| `Api.kind` | `http`, `event` |
| `Topic.kind` | `topic`, `queue` |
| `Contract.kind` | `openapi`, `asyncapi`, `pact`, `schema` |
| `Resource.kind` | `database-server`, `broker`, `cache`, `gateway`, `ingress`, `database`, `bucket` |
| `Dataset.kind` | `collection`, `table`, `view` |
| `Dataset.store` | `relational`, `document`, `key-value`, `wide-column`, `search`, `graph`, `time-series`, `object` |
| `Environment.kind` | `development`, `test`, `staging`, `production` |
| `USES_RESOURCE.access` | `read`, `write`, `read-write` |
| `state` de uma afirmação | `observed`, `inferred`, `confirmed` |
| `status` de uma afirmação | `current`, `stale` |
<!-- modelo:fim -->

Os pares são validados pelo tipo do nó, e não pelo `kind`: `ROUTES` exige um `Resource` na origem, mas não confere se ele é `gateway` ou `ingress`.

## O que é fixo e o que é livre

**Fixo**, porque as consultas, o console e o SDK dependem dele:

- os tipos de nó, os tipos de relação e os pares válidos;
- as propriedades de cada tipo: uma propriedade fora da tabela recusa o retrato inteiro. Os valores são texto, booleano, lista de textos ou, em `OrgLevel.order`, número;
- os valores das propriedades com lista fechada (tabela [Valores fixos](#valores-fixos)): `Component.kind`, `Environment.kind` e os demais;
- o formato da chave e o prefixo de cada tipo;
- os formatos dos artefatos de build lidos pelo `graph-publish` (manifesto, clientes HTTP, acesso a dados), especificados em [adapters/schemas/](https://github.com/panorama-graph/adapters/tree/main/schemas).

**Livre**, definido pela organização:

- **os identificadores:** os nomes dos ambientes (`env:dev`, `env:hml`, `env:prod`, quantos houver), dos domínios, sistemas, times, pessoas, componentes, tecnologias e bibliotecas. O ambiente tem nome livre e um estágio fixo (`kind`), que dá a ordem até a produção;
- **as fontes:** o nome da `source` (minúsculas, dígitos e hífen) e as chaves e valores do `scope`;
- **a organização em grupos:** `Group PART_OF Group` aninha quantos níveis houver, e os níveis (`OrgLevel`) têm o nome que a organização usa (veja [Estrutura organizacional](#estrutura-organizacional));
- **os textos:** `name` e `description` de qualquer nó, `role` em `MEMBER_OF`.

### Receitas de chave

Fontes diferentes só falam do mesmo nó se usarem a mesma chave. O [SDK](../sdks/typescript/README.md) tem as receitas (`@panorama-graph/sdk`, `keys`), e os adaptadores as usam. Ao montar retratos à mão, siga as mesmas; sem o SDK, as regras de normalização e os casos de teste estão no [ADAPTADOR.md](ADAPTADOR.md#receitas-de-chave):

| Nó | Chave | Exemplo |
|---|---|---|
| `Component` | `component:<caminho do repositório>` | `component:example/catalog/product-api` |
| `Repository` | `repo:<host>/<caminho>` | `repo:git.example.com/example/catalog/product-api` |
| `Api` | `api:<serviço>/http`; versionada, `api:<serviço>/<versão>/http` | `api:product-api/http`, `api:product-api/v1/http` |
| `Endpoint` | `endpoint:<serviço>/<MÉTODO> <caminho>`, com os parâmetros sem nome; numa API versionada, `endpoint:<serviço>/<versão>/<MÉTODO> <caminho>` | `endpoint:product-api/GET /products/{}`, `endpoint:product-api/v1/GET /products/{}` |
| `Topic` | `topic:<endereço do canal>`, com a versão que estiver no nome | `topic:catalog.product-created`, `topic:catalog.product-created.v1` |
| `Contract` | `contract:openapi/<serviço>`, `contract:asyncapi/<serviço>`, `contract:pact/<consumidor>→<provedor>` | `contract:pact/checkout-api→product-api` |
| `Library` | `lib:maven/<grupo>:<artefato>`, ou `lib:<tipo>/<namespace>/<nome>` para outros purls | `lib:npm/@fastify/fastify` |
| `Technology` | `tech:<nome>` | `tech:spring-boot`, `tech:postgresql` |
| `Dataset` | `dataset:<caminho do componente>/<nome>` | `dataset:example/catalog/product-api/products` |
| `Resource` | instância `resource:<ambiente>/<nome>`; recurso lógico `resource:<ambiente>/<instância>/<nome>` | `resource:dev/postgres`, `resource:dev/postgres/catalog` |
| `Environment` | `env:<ambiente>`, o mesmo nome do primeiro segmento da chave do recurso | `env:dev` |
| `Domain`, `System`, `Group` | o identificador curto na fonte | `domain:catalog`, `system:catalog/products`, `group:catalog-team` |
| `OrgLevel` | o nome do nível na organização | `level:tribo`, `level:time` |
| `Person` | o login no diretório | `person:maria.silva` |

### Estrutura organizacional

Os grupos se aninham com `Group PART_OF Group`, e cada um diz o seu nível com `AT_LEVEL`. Os níveis são nós (`OrgLevel`) com o nome que a organização usa: o modelo não tem lista fixa de níveis nem limite de profundidade.

| Propriedade do nível | O que é |
|---|---|
| `name` | O nome do nível na organização (Diretoria, Superintendência, Tribo, Time) |
| `order` | A posição de cima para baixo (1 é o topo). O console usa a posição para a cor do nível no organograma. Um nível lateral, como chapter ou guilda, repete a posição do nível ao lado |
| `team` | `true` nos níveis cujos grupos são times: os que entregam e são donos de componentes. É o que as ferramentas usam para saber onde parar ao subir a árvore atrás do time |

Um exemplo com quatro níveis, num retrato do diretório no formato do `graph-seed`:

```yaml
nodes:
  - { key: level:diretoria, name: Diretoria, order: 1, evidence: levels/diretoria }
  - { key: level:superintendencia, name: Superintendência, order: 2, evidence: levels/superintendencia }
  - { key: level:tribo, name: Tribo, order: 3, evidence: levels/tribo }
  - { key: level:time, name: Time, order: 4, team: true, evidence: levels/time }
  - { key: group:tecnologia, name: Diretoria de Tecnologia, evidence: groups/tecnologia }
  - { key: group:produtos-digitais, name: Superintendência de Produtos Digitais, evidence: groups/produtos-digitais }
relations:
  - { type: AT_LEVEL, from: group:tecnologia, to: level:diretoria, evidence: groups/tecnologia }
  - { type: AT_LEVEL, from: group:produtos-digitais, to: level:superintendencia, evidence: groups/produtos-digitais }
  - { type: PART_OF, from: group:produtos-digitais, to: group:tecnologia, evidence: groups/produtos-digitais }
```

A posição na árvore não precisa seguir a ordem dos níveis: um time pode ficar direto sob a diretoria. O nível vem da mesma fonte que os grupos (o diretório), e a hierarquia é a do `PART_OF`, nunca a do `order`.

### Versões de APIs e tópicos

Uma API ou um tópico com duas versões que convivem (a v1 ainda servida enquanto os consumidores migram para a v2) são dois nós, cada um com `version` (`v1`, `v2`): quem consome uma versão é quem aponta para o nó dela. A versão é só a maior, no formato `v<N>`; a interface sem versão não tem `version`, e a chave é a de sempre. A release do componente (1.4.0, 2.0.0) não é versão da interface: é a versão implantada (`DEPLOYED_IN`).

A fonte que sabe a versão a declara: o OpenAPI e o AsyncAPI pela extensão `x-panorama-graph-version`, os clientes HTTP pelo campo `version`. Sem declaração, valem as convenções, aplicadas pelas mesmas funções do SDK em todos os produtores:

| Versionamento | Como se reconhece | Quem afirma | Função do SDK |
|---|---|---|---|
| No código | primeiro segmento do caminho, `GET https://servico-xpto.example.com/v1/products` | o provedor (OpenAPI) e cada cliente: uma API por versão, com os próprios endpoints (`endpoint:servico-xpto/v1/GET /v1/products`) | `pathVersion` |
| Na infraestrutura | sufixo `-v<N>` no nome do serviço exposto, `GET https://servico-xpto-v2.example.com/products` | o cliente consome `api:servico-xpto/v2/http`; quem lê a implantação (o Service `servico-xpto-v2` do componente) afirma `PROVIDES` dela e `VERSION_OF` para a API do código | `splitServiceVersion` |
| No nome do tópico | sufixo `-v<N>` ou `.v<N>`, `product-created.v1` | quem publica e quem consome: cada versão é um tópico | `topicVersion` |

No versionamento na infraestrutura, o código não sabe da versão: o nome de serviço continua sem ela (`spring.application.name: servico-xpto`), e a API que o build publica é a do código (`api:servico-xpto/http`), com os endpoints. As versões expostas não têm endpoints próprios: o cliente chama os do código (`endpoint:servico-xpto/GET /products`), e `api_consumers` os encontra pelo `VERSION_OF`.

Uma chave diferente para a mesma coisa vira um nó duplicado. Ele se resolve com um apelido (`POST /v1/nodes/{key}/aliases`) ou com a união dos dois (`POST /v1/nodes/merge`), sem recarregar nada.

## De onde vem cada fato

| Assunto | Nós e relações | Quem publica |
|---|---|---|
| Organização | `Group`, `OrgLevel`, `Person`, `PART_OF` entre grupos, `AT_LEVEL`, `MEMBER_OF` | O diretório da empresa. Sem adaptador do produto: um adaptador próprio (o `example-seed` é o modelo) ou o `graph-seed` |
| Catálogo | `Domain`, `System`, `PART_OF`, `OWNED_BY`, os componentes de infraestrutura (`kind: infra`) | O catálogo de serviços. Sem adaptador: `graph-seed` |
| Build de cada componente | `Component`, `Repository`, `HOSTED_IN`, `BUILT_WITH`, `DEPENDS_ON`, `Api`, `Endpoint`, `PROVIDES`, `HAS_ENDPOINT`, `CONSUMES`, `CALLS`, `Topic`, `PUBLISHES`, `SUBSCRIBES`, `Contract`, `SPECIFIED_BY`, `Dataset`, `OWNS_DATA`, `READS`, `WRITES` | `graph-publish`, no CI de cada componente, a partir dos artefatos do build |
| O que roda em cada ambiente | `Environment`, `DEPLOYED_IN` | `graph-deployments`, que lê o cluster Kubernetes |
| Infraestrutura | `Environment`, `Resource`, `IN_ENVIRONMENT`, `RUNS`, `INSTANCE_OF`, `ROUTES`, `REACHES_VIA` | Os manifestos do cluster. Sem adaptador do produto: um adaptador próprio (o `example-seed` é o modelo) ou o `graph-seed` |
| Configuração de cada serviço | `USES_RESOURCE`, `HOSTED_ON` (banco no servidor, tópico no broker) | A configuração de implantação. Sem adaptador: `graph-seed` |

O uso de cada adaptador está no [README dos adaptadores](https://github.com/panorama-graph/adapters#readme). Uma fonte que nenhum adaptador lê entra por um adaptador próprio da organização (o [example-seed](https://github.com/panorama-graph/adapters/tree/main/example-seed) é o ponto de partida: lê os exports, traduz com as receitas do SDK e publica), pelo `graph-seed` (YAML) ou direto pelo `POST /v1/ingest` (veja o [ADAPTADOR.md](ADAPTADOR.md), com um exemplo de carga para cada relação).

## Quando algo não cabe no modelo

O modelo é fechado: um adaptador nunca cria um tipo de nó, de relação ou de propriedade. Antes de propor uma mudança, veja se o conceito já tem lugar:

| Na sua organização | No modelo |
|---|---|
| Tribo, chapter, diretoria, vertical | `Group` aninhado com `PART_OF`, no `OrgLevel` com esse nome (`AT_LEVEL`) |
| Função serverless, worker, consumidor de fila | `Component` (`kind: service` ou `job`) |
| Micro-frontend, app móvel | `Component` (`kind: frontend`) |
| API gateway, service mesh, load balancer | `Resource` (`kind: gateway` ou `ingress`), com `ROUTES` |
| Fila (SQS, RabbitMQ) | `Topic` (`kind: queue`), com `HOSTED_ON` para o broker |
| Bucket, blob storage | `Resource` (`kind: bucket`) |
| Schema de banco ou de mensagem | `Dataset` (`kind: table` ou `collection`) ou `Contract` (`kind: schema`) |
| Homologação, sandbox, pré-produção | `Environment` com o nome que for e o `kind` mais próximo (`test`, `staging`) |

Quando não cabe, o modelo muda numa **versão nova**, na API (`api/`):

1. Acrescente o tipo, o par, a propriedade ou o valor em [src/model/model.ts](src/model/model.ts) e suba `MODEL_VERSION`.
2. Regere o que sai do modelo: `bun run modelo:write` (este documento), `bun run openapi:write` e `bun run sdk:generate`, e suba a versão do SDK em `sdks/typescript/package.json`.
3. Registre a versão e o que mudou em [Versões do modelo](#versões-do-modelo), no fim deste documento.
4. Se uma pergunta precisa da relação nova, ela entra numa ferramenta de consulta (`src/query/tools.ts`). Sem isso, a relação já aparece no `node_get` (todas as relações de um nó) e no `graph_query`, mas não nas ferramentas específicas, como `component_get` e `architecture_overview`.
5. Ajuste o console no mesmo commit (ele usa o SDK pelo workspace). Publique o SDK e passe os [adaptadores](https://github.com/panorama-graph/adapters) e os adaptadores próprios da organização para a versão nova. Todos conferem a versão do modelo antes de enviar e recusam uma API em outra versão: com versões diferentes, a carga seria recusada ou perderia o que um lado não conhece.

Acrescentar só amplia o que é aceito, e as cargas antigas continuam válidas. Renomear ou remover algo invalida as cargas que o usam: cada fonte precisa mandar um retrato novo no modelo novo.

## Versões do modelo

O vocabulário segue o [modelo de entidades do Backstage](https://backstage.io/docs/features/software-catalog/system-model), para facilitar a vinda de quem já tem um catálogo, com as extensões de que o grafo precisa.

| Versão | O que mudou |
|---|---|
| 1 | Domínios, sistemas, componentes, repositórios, APIs, endpoints, tópicos, contratos, recursos, grupos, pessoas, tecnologias e bibliotecas, com as relações entre eles. Os pares são validados por tipo de nó, não por `kind` |
| 2 | `direct`, `declared` e `used` em `DEPENDS_ON` |
| 3 | `Dataset` (`kind`, `store`), `OWNS_DATA`, `READS` e `WRITES` |
| 4 | `contract` em `Endpoint` |
| 5 | `operationId` em `Endpoint`, e o nome do endpoint passa a ser `MÉTODO /caminho` |
| 6 | `kind: infra` em `Component` e `INSTANCE_OF` |
| 7 | `kind` em `Topic`: `topic` ou `queue` |
| 8 | `lead` em `MEMBER_OF` |
| 9 | `Environment` e `IN_ENVIRONMENT`; `store` do `Dataset` passa a ser a categoria do banco |
| 10 | `DEPLOYED_IN` e o retrato congelado por commit (`revision`) |
| 11 | `version` em `Api` e `Topic` (um nó por versão da interface), `VERSION_OF` e `via` em `DEPENDS_ON` |
| 12 | `OrgLevel` e `AT_LEVEL` (os níveis da estrutura organizacional como nós), propriedade numérica (`order`) e `Group` sem `kind` |

`Module` e `CONTAINS` (banco → dataset) ainda não fazem parte, e entram como mudança versionada.

