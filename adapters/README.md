# adapters

Adaptadores de carga do [panorama-graph-api](../api): leem uma fonte, traduzem o que ela afirma para o modelo do grafo e enviam retratos ao `POST /v1/ingest`.

- **`graph-publish`**: o pipeline de cada componente publica a arquitetura gerada no próprio build.
- **`graph-receiver`**: o serviço que recebe esses mesmos artefatos pela rede (`POST /v1/builds`) e os publica com a tradução do `graph-publish`. É para onde o plugin Gradle envia (`./gradlew architecturePublish`): o pipeline não precisa de imagem do grafo.
- **`graph-deployments`**: lê o cluster e publica o que está implantado em cada ambiente, congelando o retrato de cada commit em execução.
- **`graph-seed`**: envia retratos declarados em YAML. Serve para a carga à mão do que ainda não tem adaptador.

## graph-publish

```bash
bun install
bun run graph-publish build/architecture --dry-run          # monta os retratos e mostra o resumo
bun run graph-publish build/architecture --dry-run --print  # e imprime os retratos em JSON
GRAPH_API_URL=http://localhost:3200 bun run graph-publish build/architecture
```

Lê um diretório de artefatos do build e envia **um retrato por artefato**. O escopo de cada retrato é o componente, `{ component: <caminho do repositório> }`. Quando um artefato falta, a fonte dele não é enviada, e a API mantém o último retrato que recebeu. Quando o artefato existe mas vem vazio (por exemplo, nenhum cliente HTTP), sai um retrato vazio, e o que aquela fonte afirmava antes vira `stale`.

| Arquivo | Formato | Fonte (`source`) | Fatos |
|---|---|---|---|
| `manifest.json` | [manifesto](#manifesto) | `build-manifest` | Component, Repository, `HOSTED_IN`, Technology, `BUILT_WITH {version}`, Library e `PRODUCES {version}` |
| `bom.json` | CycloneDX (JSON) | `sbom` | Library, `DEPENDS_ON {version, scope: runtime, resolved, direct, via}` |
| `dependency-usage/declarations.json` e `usages-dependencies.json` | relatórios brutos do [dependency-analysis-gradle-plugin](https://github.com/autonomousapps/dependency-analysis-gradle-plugin) | `dependency-usage` | `DEPENDS_ON {declared, used, scope}` |
| `openapi.json` | OpenAPI 3 ou Swagger 2 | `openapi` | Api `http`, Endpoint (nomeado `MÉTODO /caminho`, com `operationId` e `contract`: parâmetros, corpo, respostas e o fecho dos `$ref` em `components`; acima de 64 KB, sem o fecho e com aviso), `PROVIDES`, `HAS_ENDPOINT`, Contract `openapi`, `SPECIFIED_BY` |
| `asyncapi.json` | AsyncAPI 3 ou 2 | `asyncapi` | Topic, `PUBLISHES`/`SUBSCRIBES`, Contract `asyncapi`, `SPECIFIED_BY` |
| `http-clients.json` | [clientes HTTP](#clientes-http) | `http-clients` | `CONSUMES`, `CALLS` |
| `data-access.json` | [acesso a dados](#acesso-a-dados) | `data-access` | Dataset, `OWNS_DATA`, `READS`, `WRITES` |
| `pacts/*.json` | Pact (v2 a v4, interações HTTP) | `pact` | `CONSUMES`, `CALLS`, Contract `pact`, `SPECIFIED_BY` |
| `application.json` | [aplicação](#aplicação) | — | Nome de serviço (ver [Identidade](#identidade)) |

A saída é `0` quando tudo foi publicado, ou quando a API já tinha um retrato mais novo (`409`), o que não é erro. É `1` num erro de uso ou de leitura, inclusive quando a API está em outra versão do modelo (conferida no `GET /schema` antes de qualquer envio). É `2` quando a API recusa um retrato; os erros de validação são impressos.

### Identidade

| O quê | De onde vem, em ordem | Exemplo |
|---|---|---|
| Caminho do repositório (chave do componente) | `--component`, `CI_PROJECT_PATH`, `GITHUB_REPOSITORY`, `manifest.component.repository` | `acme/credito/product-catalog-api` |
| Host do repositório | `--host`, `CI_SERVER_HOST`, `GITHUB_SERVER_URL`, `manifest.component.repository` | `gitlab.acmebank.example` |
| Commit | `--commit`, `CI_COMMIT_SHA`, `GITHUB_SHA`, `manifest.component.commit` | `deaaa55…` |
| Nome de serviço | `--service`, `application.json`, fim do caminho | `product-catalog` |

**O nome de serviço é o nome com que os clientes conhecem o componente:** é o participante nos pacts e o grupo dos clientes HTTP. É ele que nomeia a API e os endpoints (`api:product-catalog/http`). Assim, o provedor (pelo OpenAPI) e os consumidores (pelo Pact e pelos clientes) chegam à mesma chave sem precisar de apelidos. O componente continua identificado pelo caminho do repositório, e a relação `PROVIDES` liga os dois.

### Receitas de chave

As receitas são as do SDK do grafo (`@panorama-graph/sdk`, em [sdks/typescript](../sdks/typescript/README.md), usado aqui pelo workspace), reexportadas em [src/core/keys.ts](src/core/keys.ts): todo produtor precisa usar as mesmas para que fatos de fontes diferentes caiam no mesmo nó. O tipo do retrato, a versão do modelo e o cliente do REST também vêm do SDK.

| Nó | Chave |
|---|---|
| Component | `component:<caminho do repositório>` |
| Repository | `repo:<host>/<caminho>` |
| Api | `api:<serviço>/http`; versionada, `api:<serviço>/<versão>/http` (`api:product-api/v1/http`) |
| Endpoint | `endpoint:<serviço>/<MÉTODO> <caminho>`, com os parâmetros sem nome: `GET /products/{}`. Numa API versionada no código, `endpoint:<serviço>/<versão>/<MÉTODO> <caminho>`; a versão do host não entra. O caminho original, com os nomes, fica na propriedade `path`. |
| Topic | `topic:<endereço do canal>`, com a versão que estiver no nome |
| Contract | `contract:openapi/<serviço>`, `contract:asyncapi/<serviço>`, `contract:pact/<consumidor>→<provedor>` |
| Library | `lib:maven/<grupo>:<artefato>`, ou `lib:<tipo>/<namespace>/<nome>` para outros purls |
| Technology | `tech:<nome>` |
| Dataset | `dataset:<caminho do componente>/<nome>`. O build não sabe em que banco de cada ambiente o dataset está, então ele é identificado pelo componente que o mapeia. |
| Domain, System, Group | `domain:<id>`, `system:<id>`, `group:<id>`, pelo identificador curto na fonte (`credito`, `squad-simulacao-credito`) |
| Person | `person:<login>` no diretório (`juliana.ribeiro`) |
| Resource | instância `resource:<ambiente>/<nome>` (`resource:dev/mongodb`); recurso lógico nela `resource:<ambiente>/<instância>/<nome>` (`resource:dev/mongodb/product-catalog`) |
| Environment | `env:<ambiente>`, com o mesmo nome do primeiro segmento da chave do recurso (`env:dev`). A instância aponta para ele com `IN_ENVIRONMENT`; o recurso lógico herda o ambiente da instância em que está. |

### Evidência

`evidenceBase` é `<caminho>@<commit>:`, e cada fato completa com o caminho a partir da raiz do repositório:
- **fatos de artefato:** o arquivo em `build/architecture/`, com ponteiro JSON quando aponta para um trecho (`openapi.json#/paths/~1products~1{id}/get`). O diretório muda com `--evidence-dir`.
- **clientes HTTP:** o arquivo do cliente que o gerador informa em `source`, com a função de cada operação (`src/main/java/.../CatalogClient.java#getProduct`). Sem `source`, o ponto do artefato (`http-clients.json#/clients/0/operations/0`).
- **acesso a dados:** a entidade que mapeia o dataset (`OWNS_DATA`) e a linha da chamada (`READS`, `WRITES`: `src/main/java/.../MongoProductRepository.java#L24`).
- **OpenAPI e AsyncAPI gerados sem o build:** quem escreve o documento à mão (ou com um gerador de outra stack) informa o ponto do código na extensão `x-panorama-graph-source`, um caminho relativo à raiz do repositório com `#L<linha>` ou `#<função>` opcional. No OpenAPI, ela vale em `info` (a API e o `PROVIDES`), na operação ou no path item (o endpoint e o `HAS_ENDPOINT`). Na AsyncAPI, no canal (o tópico) e na operação (`PUBLISHES` e `SUBSCRIBES`; sem ela, a do canal). Sem a extensão, a evidência é o ponto do artefato; o contrato (`Contract`, `SPECIFIED_BY`) aponta sempre para o artefato. Um valor que não é caminho no repositório (absoluto, com `..`, URL) é ignorado, com aviso.

  ```json
  "paths": { "/orders/{id}": { "get": { "operationId": "getOrder", "x-panorama-graph-source": "src/main/java/com/example/OrderController.java#L42" } } }
  ```

### Regras de tradução

- **SBOM:** entram as bibliotecas diretas e as transitivas. `direct` diz se a biblioteca é dependência direta do componente raiz do SBOM. Na transitiva, `via` traz as dependências diretas que a trazem, por qualquer caminho da árvore (`dependencies` do SBOM): é a que se atualiza para trocar a versão dela. O SBOM afirma a versão resolvida, `direct` e `via`; o `dependency-usage` afirma só `declared` e `used`.
- **Uso de dependências:** só conta o código principal. Entra o que é declarado ou usado; o resto do classpath fica só no SBOM. Um BOM declarado como `platform` não entra. Uma dependência declarada que só agrega outras (um starter) não tem classe própria, e o relatório a daria como não usada. Com o SBOM, ela conta como usada quando alguma biblioteca que ela traz é usada.
- **Pact:** o pact tem caminhos concretos (`/products/product-1`). Cada interação é casada com as operações dos clientes HTTP do mesmo build para o mesmo provedor e vira `CALLS` para a operação. Interação sem operação que case fica só no `CONSUMES`, com aviso. Pacts só de mensagens ficam para o AsyncAPI.
- **Acesso a dados:** `OWNS_DATA` só quando a classe que mapeia o dataset é do próprio componente (`declaredIn: project`). Cada dataset acessado vira `READS` e/ou `WRITES` (`read-write` dá os dois), com a evidência do primeiro ponto de chamada. O que o build não resolveu (`unresolved`) não vira fato: sai como aviso.
- **AsyncAPI:** na versão 3, `send` é publicar e `receive` é consumir. Na versão 2, `subscribe` é a aplicação publicando e `publish` é ela consumindo. Um canal com placeholder não resolvido (`${...}`) fica de fora, com aviso.
- **Versões de APIs e tópicos:** duas versões que convivem são dois nós, cada um com `version` (`v1`, `v2`); sem versão, a chave é a de sempre ([Versões de APIs e tópicos](../api/MODELO.md#versões-de-apis-e-tópicos)). A versão declarada vence a da convenção: `x-panorama-graph-version` no OpenAPI (na operação, no path item ou em `info`) e no canal do AsyncAPI, e `version` na operação dos clientes HTTP; é por ela que entra o que a convenção não lê (cabeçalho, media type, tipo da mensagem). Sem declaração, valem as convenções do SDK. **No código**, o primeiro segmento `/v<N>` do caminho: uma API por versão, com os próprios endpoints, no provedor e nos clientes. **No tópico**, o sufixo `-v<N>` ou `.v<N>` do nome. **Na infraestrutura**, o sufixo `-v<N>` no nome do serviço exposto: o cliente que chama `product-api-v2` (`version` do cliente, a do `group` sem `service`, ou a do nome do provedor no pact) consome `api:product-api/v2/http`, mas chama os endpoints do código, sem a versão do host (`endpoint:product-api/GET /products`). O provedor não sabe dessa versão (o nome de serviço do código é sem ela): quem liga a versão exposta ao componente é o `graph-deployments`. No pact, a interação só casa com a operação conhecida da mesma versão do código.

### Formatos do produto

Manifesto, aplicação, clientes HTTP e acesso a dados não têm padrão de fora, e o produto define o formato de cada um. A especificação está em JSON Schema, em [schemas/](schemas/):

| Arquivo | `format` | Esquema |
|---|---|---|
| `manifest.json` | `panorama-graph-manifest/1` | [manifest.schema.json](schemas/manifest.schema.json) |
| `application.json` | `panorama-graph-application/1` | [application.schema.json](schemas/application.schema.json) |
| `http-clients.json` | `panorama-graph-http-clients/2` | [http-clients.schema.json](schemas/http-clients.schema.json) |
| `data-access.json` | `panorama-graph-data-access/2` | [data-access.schema.json](schemas/data-access.schema.json) |

O `graph-publish` confere o `format` de cada um. Um artefato sem `format` é lido como o formato atual, com aviso. Outro nome, de outro formato ou de uma versão que ele não lê, é erro, e nada é publicado. Campo novo e opcional é mudança compatível e fica na mesma versão; o resto é versão nova do formato.

### Manifesto

```json
{
  "format": "panorama-graph-manifest/1",
  "component": { "group": "com.example.catalog", "name": "product-api", "version": "1.2.3",
                 "repository": "ssh://git@git.example.com/example/catalog/product-api.git", "commit": "deaaa55…" },
  "technologies": [{ "name": "java", "version": "25" }, { "name": "spring-boot", "version": "4.1.0" }],
  "packages": [{ "purl": "pkg:maven/com.example.catalog/product-api-client@1.2.3" }]
}
```

Fora o `format`, todos os campos são opcionais quando o CI fornece a identidade. `technologies` vira `BUILT_WITH`. `packages` são os pacotes que o build gera e publica (num repositório de vários módulos, os de todos), pelo purl com a versão: cada um vira `PRODUCES`, o que liga o componente de uma biblioteca aos componentes que dependem dos pacotes dele.

### Aplicação

```json
{ "format": "panorama-graph-application/1", "name": "product-api" }
```

O nome com que os clientes conhecem o serviço, que nomeia a API e os endpoints (ver [Identidade](#identidade)). Fica fora do manifesto porque quem o sabe é a aplicação (num serviço Spring, o `spring.application.name` resolvido no contexto), e não o build.

### Clientes HTTP

```json
{
  "format": "panorama-graph-http-clients/2",
  "clients": [{
    "group": "product-api-v1",
    "service": "product-api",
    "version": "1",
    "type": "com.example.checkout.catalog.CatalogClient",
    "source": "src/main/java/com/example/checkout/catalog/CatalogClient.java",
    "operations": [{ "method": "GET", "path": "/products/{id}", "function": "getProduct" }]
  }]
}
```

`group` é o nome do destino na infraestrutura. `service` é o serviço de destino, sem a versão que vai no host, e `version` (`1` ou `v1`), a versão que vai no host, quando há: os dois ligam o cliente à API daquela versão (`api:product-api/v1/http`), e as operações aos endpoints do código. Artefatos sem `service` usam `group`, com a versão pela convenção (`product-api-v1` é o serviço `product-api`, `v1`). Sem versão no host, vale a de cada operação: o `version` dela, quando quem gera o artefato sabe a versão por outro meio, ou o primeiro segmento do caminho (`/v1/products`). `source` (o arquivo do cliente, relativo à raiz do repositório) e `function` (a função ou o método que faz a chamada) são a evidência; o graph-publish não deduz o arquivo do tipo, então vale para qualquer linguagem e layout. A versão 1 tinha `javaMethod` no lugar de `function` e não é mais lida.

### Acesso a dados

```json
{
  "format": "panorama-graph-data-access/2",
  "datasets": [{ "name": "products", "store": "document", "kind": "collection",
                 "type": "com.example...ProductDocument", "declaredIn": "project", "source": "src/main/java/.../ProductDocument.java" }],
  "accesses": [{ "dataset": "products", "store": "document", "operation": "write",
                 "via": "com.example...ProductRepository#save", "caller": "com.example...ProductService#create",
                 "source": "src/main/java/.../ProductService.java", "line": 24 }],
  "unresolved": [{ "reason": "nome da coleção em variável", "via": "...", "caller": "...", "source": "...", "line": 40 }]
}
```

- `store`: a categoria do banco, a mesma de `Dataset.store` no modelo do grafo: `relational`, `document`, `key-value`, `wide-column`, `search`, `graph`, `time-series` ou `object`. O motor (MongoDB, PostgreSQL) não vai no artefato: o build não sabe em que instância o banco de cada ambiente está, e o motor é afirmado por quem conhece a instância (`RUNS`). A versão 1 trazia o motor (`mongodb`) e não é mais lida. `kind`: `collection` ou `table`.
- `declaredIn`: `project` (classe do componente), `library` (entidade de uma dependência) ou `none` (coleção citada só pelo nome).
- `operation`: `read`, `write` ou `read-write`.

## Gerar os artefatos

Qualquer build que produza esses arquivos serve. Para projetos Gradle, o produto tem o plugin [panorama-graph](../gradle-plugin/README.md) (`./gradlew architectureArtifacts`), que gera cada artefato só quando o projeto tem de onde tirá-lo. Na organização de exemplo (ACME Bank), a biblioteca interna aplica esse plugin, e o template de pipeline guarda `build/architecture/` como artefato do job `tests`.

### No pipeline

Há dois jeitos, com a mesma tradução e os mesmos retratos.

**Pelo `graph-receiver`** (o padrão para Gradle). O job envia o diretório ao receptor do grafo, como um scanner envia a análise ao servidor. Com o plugin, `./gradlew architecturePublish`; sem ele, o [pacote](#graph-receiver) por `curl`:

```yaml
publish_architecture:
  needs: [{ job: tests, artifacts: true }]
  allow_failure: true
  script:
    - ./gradlew architecturePublish -PpanoramaGraph.url="$PANORAMA_GRAPH_URL"   # em MR: -PpanoramaGraph.dryRun
```

**Pelo `graph-publish`**, numa imagem no pipeline. A imagem do `Dockerfile` traz os CLIs (`graph-publish`, `graph-deployments`, `graph-seed` e `graph-receiver`) compilados em binários, sobre uma base com shell, `tar` e `kubectl`. O build instala o SDK do registry npm configurado em `.npmrc` (o escopo `@panorama-graph`); com o registry em `localhost`, o build usa a rede do host:

```bash
docker build --network host -t panorama-graph-publish:0.1.0 .   # nesta pasta (adapters/)
```

O job roda depois do build, com o diretório de artefatos do build. A identidade sai das variáveis do CI, e o repositório não precisa ser clonado de novo:

```yaml
publish_architecture:
  image: panorama-graph-publish:0.1.0
  needs: [{ job: tests, artifacts: true }]
  variables: { GIT_STRATEGY: none }
  allow_failure: true
  script:
    - graph-publish build/architecture --api "$GRAPH_API_URL"   # em MR: --dry-run
```

Publique de uma branch só, a que representa o estado vigente do componente. Duas branches publicando no mesmo escopo trocariam os retratos uma da outra a cada build. No ACME Bank, o job está no template `java-gradle-api.yml`, pelo `architecturePublish`, e publica da `develop/X.Y.Z`.

Esse é o retrato da **linha principal**, o padrão das consultas. Cada retrato leva `revision` (o componente, o commit e a versão do `manifest.json`, ou `--version`), e a API passa a saber de que commit é a linha principal.

### Pacote de artefatos por commit

Para o grafo mostrar a versão que roda em cada ambiente, o pipeline guarda os artefatos de cada build que vira imagem, num repositório de arquivos, com o commit no caminho:

```yaml
publish_architecture_bundle:
  needs: [{ job: tests, artifacts: true }]
  script:
    - tar -czf architecture.tar.gz -C build/architecture .
    - curl --fail -u "$USER:$PASSWORD" --upload-file architecture.tar.gz "$BUNDLES_URL/$CI_PROJECT_PATH/$CI_COMMIT_SHA.tar.gz"
```

Quem lê o pacote é o `graph-deployments`, quando vê aquele commit rodando: o pipeline não decide o que está implantado.

`graph-publish --revision` publica um diretório de artefatos como **retrato congelado** do commit: o escopo leva o `commit`, e o retrato só aparece no recorte de um ambiente em que o commit está implantado. O `graph-deployments` o usa; à mão, só para recuperar um retrato.

## graph-receiver

```bash
GRAPH_API_URL=http://localhost:3200 bun run graph-receiver          # porta 3210 (--port ou RECEIVER_PORT)
docker run -p 3210:3210 panorama-graph-publish:0.1.0 graph-receiver --api http://api:3200
```

O receptor dos pacotes de build: recebe os artefatos de `build/architecture` num `POST /v1/builds`, monta os retratos com a tradução do `graph-publish` e os grava no `POST /v1/ingest`. A API continua só guardando e servindo fatos; o receptor é um adaptador como os outros, que sobe com a instância. O corpo (formato `panorama-graph-build/1`, em [schemas/build.schema.json](schemas/build.schema.json)) leva cada arquivo JSON pelo caminho relativo:

```json
{
  "format": "panorama-graph-build/1",
  "files": { "manifest.json": { "...": "..." }, "openapi.json": { "...": "..." }, "pacts/web-catalog-api.json": { "...": "..." } },
  "options": { "version": "1.4.0", "kind": "service" },
  "dryRun": false
}
```

- **Identidade só do pacote.** O componente, o host e o commit vêm do `manifest.json` (que o build gera com as variáveis do CI ou o git), com `options` por cima. As variáveis de ambiente do receptor nunca entram.
- **`dryRun`** monta e confere os retratos sem gravar: no MR, o pipeline valida o pacote no mesmo receptor.
- **Respostas:** `200` com o resultado de cada retrato (`ok`, `outdated` ou, no `dryRun`, `planned`); `400` (`invalid_build`) para pacote sem `manifest.json`, com caminho inválido ou com um formato que ele não lê; `422` (`snapshot_rejected`) quando a API recusa um retrato, com os erros de validação; `502` (`graph_unavailable`) quando a API não responde. Os erros seguem o formato do produto, `{ error, code, status, details }`. Com `Accept: text/plain`, a resposta é o resumo do `graph-publish`, que o plugin mostra no build.
- **Sem autenticação**, como a API (ver as perguntas em aberto do [ROADMAP](../ROADMAP.md#perguntas-em-aberto)). Tamanho máximo de um pacote: 32 MB (`--max-body-mb`).

Sem o plugin, o mesmo pacote sai do diretório com `jq` (`"dryRun": true` para só conferir):

```bash
cd build/architecture
jq -n '{format: "panorama-graph-build/1", files: ([inputs | {(input_filename): .}] | add)}' \
    $(find . -name '*.json' | sed 's|^\./||' | sort) \
  | curl -sS --fail-with-body -H 'content-type: application/json' -H 'accept: text/plain' \
      --data-binary @- "$PANORAMA_GRAPH_URL/v1/builds"
```

## graph-deployments

Publica o que está implantado em cada ambiente do cluster (fonte `k8s-deployments`, escopo `{cluster, namespace}`): um `Environment` por namespace, um `DEPLOYED_IN` por componente e commit em execução, com a versão, a imagem e as réplicas, e as versões de API expostas pelos Services.

```bash
graph-deployments --api "$GRAPH_API_URL" --cluster acme \
  --bundle-url "https://nexus.example.com/repository/architecture/{component}/{commit}.tar.gz"
```

| Onde | Chave | O que é |
|---|---|---|
| Deployment | anotação `panorama-graph.io/component` | Caminho do repositório do componente (a chave dele no grafo). Workload sem ela não é componente e fica de fora |
| Deployment | anotação `panorama-graph.io/commit` | Commit de que a imagem foi construída. Sem ele, a implantação é ignorada, com aviso |
| Deployment | label `app.kubernetes.io/version` | Versão do artefato; sem ele, a tag da imagem |
| Namespace | label `panorama-graph.io/environment` | Nome do ambiente (padrão: o do namespace). Marca o namespace como ambiente, mesmo sem implantação |
| Namespace | label `panorama-graph.io/environment-kind` | Estágio: `development`, `test`, `staging`, `production` |
| Service | nome com o sufixo `-v<N>` (`product-api-v2`) e seletor que casa com os pods de um componente | A versão exposta na infraestrutura: a API `api:product-api/v2/http`, que o componente oferece (`PROVIDES`) e que é a API do código implantada (`VERSION_OF` `api:product-api/http`). Os endpoints são os do código |

- **Ordem:** primeiro congela cada commit em execução que a API ainda não tem (consulta o `sources_status`, baixa o pacote pelo `--bundle-url` e publica como retrato congelado); depois envia um retrato por ambiente.
- **Retrato em dia:** o retrato congelado montado por uma versão mais antiga destes adaptadores (o `producer` do escopo no `sources_status`), ou antes de eles informarem a versão, é refeito do mesmo pacote: um adaptador que extrai mais chega aos commits já em execução sem esperar deploy. O retrato de outro produtor não conta; sem o pacote, fica o que existe. Commit sem pacote não impede a implantação: ela é publicada, e o recorte daquele componente segue a linha principal.
- **Histórico:** a implantação que sai do ambiente (deploy novo, rollback, remoção) vira `stale` na API, e é o histórico de deploys. A API apaga o histórico e os retratos congelados vencidos (retenção).
- **Onde roda:** de dentro do cluster, como CronJob com uma ServiceAccount que só lê Deployments, Services e namespaces (o kubectl da imagem usa a credencial do pod), ou de fora, com `--deployments`, `--services` e `--namespaces` apontando para o JSON do `kubectl get ... -o json`.

## graph-seed

```bash
bun run graph-seed seeds/acme --dry-run          # monta os retratos e mostra o resumo
GRAPH_API_URL=http://localhost:3200 bun run graph-seed seeds/acme
```

Para uma primeira carga, veja o exemplo neutro dos [primeiros passos](../PRIMEIROS-PASSOS.md#primeira-carga-à-mão); o que cada tipo aceita está no [MODELO.md](../api/MODELO.md).

Lê os arquivos `*.yaml` de um diretório, em ordem alfabética, e envia cada item da lista `snapshots` como um retrato. As opções e os códigos de saída são os do `graph-publish`. O `observedAt` é o momento da carga (`--observed-at` muda).

```yaml
snapshots:
  - source: directory                 # fonte e escopo do retrato, como no POST /v1/ingest
    scope: { tenant: acme }
    evidenceBase: "https://directory.acmebank.example/"
    evidence: export                  # opcional: evidência dos itens que não trazem a sua
    nodes:
      - { key: level:time, name: Time, order: 4, team: true, evidence: levels/time }
      - { key: group:squad-simulacao-credito, name: Squad Simulação de Crédito, evidence: groups/squad-simulacao-credito }
    relations:
      - { type: AT_LEVEL, from: group:squad-simulacao-credito, to: level:time, evidence: groups/squad-simulacao-credito }
      - { type: MEMBER_OF, from: person:juliana.ribeiro, to: group:squad-simulacao-credito, role: Product Owner, lead: true, evidence: users/juliana.ribeiro }
```

- O tipo do nó vem do prefixo da chave (`group:` é Group). Os demais campos do item, além de `key`, `type`, `from`, `to` e `evidence`, são as propriedades. Os valores viram texto (`version: 17` é `"17"`), menos os booleanos e as propriedades que o modelo declara numéricas (`order` do `OrgLevel`).
- Um fato sem evidência (nem `evidence` no item ou no retrato, nem `evidenceBase`) é recusado antes do envio. O mesmo vale para chave com prefixo desconhecido e retrato sem `source` ou `scope`. A validação contra o modelo é da API, tudo ou nada.
- Cada retrato substitui o anterior da mesma fonte e escopo: o que saiu do arquivo vira `stale`.

### Carga da organização de exemplo (`seeds/acme/`)

No ACME Bank, o que ainda não tem adaptador é carregado à mão, com as fontes e as evidências que os adaptadores de leitura central vão ter. Quem consulta o grafo vê fatos `observed` dessas fontes, como no sistema final.

A organização (níveis, grupos e pessoas, fonte `directory`) e a infraestrutura dos ambientes (`k8s-infra` e `k8s-routes`) não estão aqui: vêm dos exports do ACME Bank pelo [example-seed](../example-seed/README.md), o exemplo de adaptador próprio de uma organização. A arquitetura de build dos dois serviços de exemplo vem dos artefatos de `test/fixtures/`, pelo `graph-publish`.

| Arquivo | Fonte (`source`) e escopo | Fatos |
|---|---|---|
| `service-catalog.yaml` | `service-catalog`, `{catalog}` | Domain (Crédito, Pagamentos, Plataforma de Engenharia e Infraestrutura), System, `PART_OF`, `OWNED_BY` dos domínios, sistemas, componentes e APIs; Pagamentos ainda sem sistemas nem componentes; os componentes de plataforma (a biblioteca interna, os templates de pipeline e os charts Helm), com `HOSTED_IN`; os servidores de banco (MongoDB, PostgreSQL), o Redis e o Kafka como componentes `infra` |
| `service-config.yaml` | `service-config`, `{component, environment}` | Bancos de cada serviço, `HOSTED_ON`, `USES_RESOURCE` e o tópico no broker |

O `dev` transcreve o `deploy/values-dev.yaml` de cada serviço; `stage` e `prd` espelham o `dev`. Toda a organização é fictícia.

**Exemplo da instância:** o compose da raiz carrega esta pasta, os artefatos de `test/fixtures/` e os exports do `example-seed` (perfil `exemplo`, ver os [primeiros passos](../PRIMEIROS-PASSOS.md)), com uma data fixa nas afirmações, para não sobrescrever retratos mais novos.

**Saída da carga à mão:** quando um adaptador real cobrir um assunto, o retrato correspondente sai do arquivo com a lista vazia e é reenviado, e os fatos manuais viram `stale`.

## Desenvolvimento

```bash
bun run lint   # tsc
bun test       # tradutores sobre artefatos reais em test/fixtures/
```
