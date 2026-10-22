# orders-api

Repositório `shop/orders-api` em `git.example.com`, commit `3f2c9e1a7b5d4c3e2f1a0b9c8d7e6f5a4b3c2d1e`, sem mudanças locais. Projeto Maven: os degraus 2 e 3 (init script do Gradle) não se aplicam.

| Arquivo | Degrau | De onde |
|---|---|---|
| `manifest.json` | 4 | `pom.xml` (grupo, artefato, versão, Java 21, Spring Boot 3.4.8), `.mvn/wrapper/maven-wrapper.properties` (Maven 3.9.9), `git remote` e `git rev-parse` |
| `application.json` | 4 | `src/main/resources/application.yml#L2` (`spring.application.name`) |
| `openapi.json` | 4 | `OrderController` (2 operações), DTOs `PlaceOrder`, `Order`, `OrderItem` com Bean Validation; erros do `ApiExceptionHandler` |
| `asyncapi.json` | 4 | `OrderEvents.java#L27` (`KafkaTemplate.send`), `PaymentListener.java` (`@KafkaListener`); tópicos resolvidos em `application.yml#L21-L22` |
| `http-clients.json` | 4 | `CatalogClient` (`@FeignClient(name = "catalog-api-v1")`) |
| `data-access.json` | 4 | `OrderEntity` (`@Entity`, `@Table(name = "orders")`), `OrderRepository` usado em `OrderService` |
| `bom.json` | — | Não gerado: rodar o CycloneDX não foi autorizado |

Versões: a API que o `orders-api` oferece não é versionada (nenhum caminho, anotação ou manifesto de implantação traz versão), e os tópicos também não. O catálogo é chamado na v1, pelo host: `catalog-api-v1` no `@FeignClient` (`CatalogClient.java`), que liga o cliente a `api:catalog-api/v1/http`; as operações ficam nos endpoints do código do catálogo.

Ficaram de fora: `/actuator/**`; o endpoint `GET /orders/export`, com o caminho montado em execução (lacuna).
