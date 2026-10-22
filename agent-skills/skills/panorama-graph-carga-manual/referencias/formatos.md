# Formatos do pacote de cada componente

O pacote é o mesmo diretório `build/architecture/` que o plugin Gradle gera, e o receptor o traduz com as mesmas regras. Os formatos próprios do produto têm JSON Schema em [../schemas/](../schemas/), a fonte da verdade: em caso de dúvida, vale o schema. Os outros são padrões de fora (OpenAPI, AsyncAPI, CycloneDX, Pact).

Cada arquivo vira um retrato de uma fonte, com escopo `{ component: <caminho do repositório> }`:

| Arquivo | Fonte | Formato | O que vira no grafo |
|---|---|---|---|
| `manifest.json` | `build-manifest` | `panorama-graph-manifest/1` ([schema](../schemas/manifest.schema.json)) | Componente, repositório, `HOSTED_IN`, `BUILT_WITH` |
| `application.json` | (identidade) | `panorama-graph-application/1` ([schema](../schemas/application.schema.json)) | O nome de serviço, que nomeia a API e os endpoints |
| `bom.json` | `sbom` | CycloneDX JSON | Bibliotecas e `DEPENDS_ON`, diretas e transitivas |
| `dependency-usage/` | `dependency-usage` | Relatórios do dependency-analysis | Só pelo Gradle (degraus 2 e 3); não escreva à mão |
| `openapi.json` | `openapi` | OpenAPI 3 (ou Swagger 2) | `Api`, `PROVIDES`, `Endpoint`, `HAS_ENDPOINT`, `Contract` |
| `asyncapi.json` | `asyncapi` | AsyncAPI 3 (ou 2) | `Topic`, `PUBLISHES`, `SUBSCRIBES`, `Contract` |
| `http-clients.json` | `http-clients` | `panorama-graph-http-clients/2` ([schema](../schemas/http-clients.schema.json)) | `CONSUMES` da API, `CALLS` de cada endpoint |
| `data-access.json` | `data-access` | `panorama-graph-data-access/2` ([schema](../schemas/data-access.schema.json)) | `Dataset`, `OWNS_DATA`, `READS`, `WRITES` |
| `pacts/*.json` | `pact` | Pact | `CONSUMES`, `CALLS`, `Contract` |

Um arquivo ausente não gera retrato: o grafo mantém o que tinha daquela fonte. Um arquivo vazio (`"clients": []`) afirma que não há nada e deixa `stale` o que havia. Só escreva lista vazia quando tiver lido o código inteiro e não houver mesmo.

## manifest.json

```json
{
  "format": "panorama-graph-manifest/1",
  "component": {
    "group": "com.example.shop",
    "name": "orders-api",
    "version": "1.4.0",
    "repository": "https://git.example.com/shop/orders-api.git",
    "commit": "3f2c9e1a7b..."
  },
  "technologies": [
    { "name": "java", "version": "21" },
    { "name": "spring-boot", "version": "3.4.8" }
  ]
}
```

O caminho e o host do repositório saem de `component.repository` (ssh, scp ou https, sem credencial): o componente vira `component:shop/orders-api`. É essa chave que o catálogo, as implantações e as rotas precisam usar.

## application.json

```json
{ "format": "panorama-graph-application/1", "name": "orders-api" }
```

O nome é o do código, sem a versão que vá no host (`orders-api`, mesmo que os clientes chamem `orders-api-v2`).

## openapi.json

O grafo lê `info.title` e `info.description`, `basePath` (Swagger 2) e, de cada operação, o método, o caminho, `operationId`, `summary`, e `parameters`, `requestBody` e `responses` com o fecho dos `$ref` locais, que vão inteiros para o contrato do endpoint.

`info.version` é a release do componente, e não a versão da API: o grafo não o lê. A versão da API é a declarada em `x-panorama-graph-version` (na operação, no path item ou em `info`) ou, sem ela, a do primeiro segmento de cada caminho (`/v1/orders`): uma API para cada versão encontrada (veja [Versões de APIs e tópicos](descoberta.md#versões-de-apis-e-tópicos)).

A evidência no código vai na extensão `x-panorama-graph-source`: em `info` (a API, normalmente a classe da aplicação ou o primeiro controller), em cada operação (o método do controller) ou no path item (quando todas as operações do caminho estão no mesmo lugar). Caminho relativo à raiz do repositório, com `#L<linha>` ou `#<método>`. Sem ela, a evidência é o ponto do artefato, que não existe no repositório.

```json
{
  "openapi": "3.0.3",
  "info": { "title": "orders-api", "version": "1.4.0", "x-panorama-graph-source": "src/main/java/com/example/orders/OrdersApplication.java" },
  "paths": {
    "/orders/{id}": {
      "get": {
        "operationId": "getOrder",
        "x-panorama-graph-source": "src/main/java/com/example/orders/OrderController.java#L42",
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
        "responses": { "200": { "description": "OK", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Order" } } } } }
      }
    }
  },
  "components": { "schemas": { "Order": { "type": "object", "required": ["id"], "properties": { "id": { "type": "string", "format": "uuid" } } } } }
}
```

## asyncapi.json

Use AsyncAPI 3. O grafo lê o endereço de cada canal (`channels.<id>.address`) e a direção de cada operação (`send` publica, `receive` consome). A versão do tópico é a declarada no canal (`x-panorama-graph-version`) ou, sem ela, a do fim do endereço (`-v2` ou `.v2`): escreva o endereço inteiro, como a configuração o resolve. Endereço com `${...}` é descartado. A extensão vai no canal (o tópico, normalmente onde o nome está declarado) e na operação (o ponto que publica ou consome).

```json
{
  "asyncapi": "3.0.0",
  "info": { "title": "orders-api", "version": "1.4.0" },
  "channels": {
    "orderCreated": { "address": "shop.orders.order-created", "x-panorama-graph-source": "src/main/resources/application.yml#L18" }
  },
  "operations": {
    "publishOrderCreated": {
      "action": "send",
      "channel": { "$ref": "#/channels/orderCreated" },
      "x-panorama-graph-source": "src/main/java/com/example/orders/OrderEvents.java#L27"
    }
  }
}
```

## http-clients.json

```json
{
  "format": "panorama-graph-http-clients/2",
  "clients": [
    {
      "group": "catalog-api-v1",
      "service": "catalog-api",
      "version": "1",
      "type": "com.example.orders.catalog.CatalogClient",
      "source": "src/main/java/com/example/orders/catalog/CatalogClient.java",
      "baseUrlProperty": "clients.catalog.url",
      "operations": [{ "method": "GET", "path": "/products/{id}", "function": "getProduct" }]
    }
  ]
}
```

O `service` e a `version` do cliente (a versão do host) ligam o cliente à API exposta naquela versão (`api:catalog-api/v1/http`); as operações vão para os endpoints do código, sem a versão do host (`endpoint:catalog-api/GET /products/{}`). A versão no código de uma operação é o `version` dela ou o primeiro segmento do caminho (`/v2/products/{id}` → `api:catalog-api/v2/http` e `endpoint:catalog-api/v2/GET /v2/products/{}`); sem nenhuma, a API sem versão (`api:catalog-api/http`). Os dois lados só se encontram se o provedor usar o mesmo nome de serviço, a mesma versão e o mesmo caminho.

## data-access.json

```json
{
  "format": "panorama-graph-data-access/2",
  "datasets": [
    { "name": "orders", "store": "document", "kind": "collection", "type": "com.example.orders.Order", "declaredIn": "project", "source": "src/main/java/com/example/orders/Order.java" }
  ],
  "accesses": [
    { "dataset": "orders", "store": "document", "operation": "read-write", "via": "OrderRepository", "caller": "com.example.orders.OrderService.place", "source": "src/main/java/com/example/orders/OrderService.java", "line": 31 }
  ],
  "unresolved": [
    { "reason": "SQL montado em execução", "caller": "com.example.orders.ReportService.export", "source": "src/main/java/com/example/orders/ReportService.java", "line": 58 }
  ]
}
```

## opcoes.json (fora do pacote)

Opções do envio ao receptor. O `importar.sh` as lê e não as envia como arquivo. Todas são opcionais; o que não estiver aqui vem do `manifest.json` e do `application.json`.

```json
{ "kind": "service", "service": "orders-api" }
```

| Opção | Quando usar |
|---|---|
| `kind` | `service` (padrão), `bff`, `frontend`, `job`, `library` |
| `service` | Nome de serviço, se não houver `application.json` |
| `component`, `host`, `commit` | Se o `manifest.json` não tiver o repositório ou o commit |
| `version` | Versão do artefato, se não estiver no manifesto |
| `evidenceDir` | Pacote gerado pelo Gradle num subprojeto: o caminho de `build/architecture` a partir da raiz do repositório (ex.: `api/build/architecture`) |
