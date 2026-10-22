# O que descobrir em cada repositório

Onde procurar cada fato, por tecnologia. Comece pelo que o projeto declara (configuração, anotações, manifestos) e só depois leia o fluxo do código. Anote cada achado com a evidência (`caminho#L<linha>` ou `caminho#<função>`, relativo à raiz do repositório) no `DESCOBERTA.md` do componente.

O que nenhuma seção cobre não entra: registre no `LACUNAS.md` o que viu e por que não resolveu.

## Identidade

| Fato | Onde | Vai para |
|---|---|---|
| Caminho e host do repositório | `git remote get-url origin`. O caminho é o que vem depois do host, sem `.git` (`git@git.example.com:shop/orders-api.git` → `shop/orders-api`). Tire usuário e token da URL | `manifest.json` → `component.repository` |
| Commit | `git rev-parse HEAD`. Com mudanças não commitadas, avise: a evidência é do commit | `component.commit` |
| Grupo, nome e versão do artefato | `build.gradle` (`group`, `version`, `rootProject.name`), `pom.xml`, `package.json`, `go.mod`, `pyproject.toml` | `component.group`, `name`, `version` |
| Tipo do componente | Serviço HTTP ou de eventos: `service`. BFF de um frontend: `bff`. SPA ou app: `frontend`. Roda e termina (CronJob, batch): `job`. Publicado para outros importarem: `library` | `opcoes.json` → `kind` |
| Nome de serviço | Spring: `spring.application.name` em `application.yml`/`.properties` ou `bootstrap.yml`. Outras stacks: o nome no chart, no `docker-compose`, no `Service` do Kubernetes ou na URL com que os outros o chamam | `application.json` → `name` |

O nome de serviço é o que liga provedor e consumidores: nomeia a API (`api:<serviço>/http`) e os endpoints. É o nome do código, sem a versão que vá no host: se os clientes chamam `orders-api-v2`, o serviço continua `orders-api` (veja [Versões de APIs e tópicos](#versões-de-apis-e-tópicos)). Sem `application.json`, o grafo usa o fim do caminho do repositório.

## Stack

`manifest.json` → `technologies`, um item por tecnologia com a versão resolvida. Use nomes curtos e minúsculos (`java`, `kotlin`, `gradle`, `maven`, `spring-boot`, `typescript`, `node`, `bun`, `fastify`, `react`, `vite`, `go`, `python`, `fastapi`).

| Stack | Onde |
|---|---|
| Java/Kotlin | Toolchain ou `sourceCompatibility` no build; versão do Spring Boot no bloco `plugins` ou no parent do `pom.xml`; Gradle em `gradle/wrapper/gradle-wrapper.properties` |
| Node/Bun | `engines`, `packageManager`, `bun.lock`/`package-lock.json`; frameworks nas `dependencies` (versão resolvida do lockfile) |
| Go | Diretiva `go` do `go.mod`; frameworks nos `require` |
| Python | `requires-python`; frameworks nas dependências do `pyproject.toml` ou `requirements.txt` |

Só entra o que o projeto usa de fato: uma biblioteca que chega como dependência de outra não é stack.

**Versão definida fora do repositório.** Num projeto que aplica um plugin de convenção ou um BOM da organização (uma biblioteca interna), o Java, o Spring Boot e outras versões vêm dele, e não aparecem no build do projeto. Procure no artefato publicado da biblioteca interna (o POM ou o BOM no repositório Maven, ou o cache do Gradle em `~/.gradle/caches/modules-2`), na versão que o projeto declara. Sem acesso, a tecnologia entra sem versão, e a versão vira lacuna. Declare a própria biblioteca interna como tecnologia, com a versão que o projeto usa.

## Bibliotecas

`bom.json` em CycloneDX JSON, com a árvore `dependencies` a partir de `metadata.component`. O grafo lê o `purl` de cada componente e quem é dependência direta. Só do classpath de execução: dependências de teste e de build ficam de fora.

- Gradle: os degraus 2 e 3 já geram.
- Outras stacks, só com permissão para rodar ferramentas e com a saída fora do repositório: `npx @cyclonedx/cyclonedx-npm --omit dev --output-file <carga>/bom.json`, `cyclonedx-gomod app -json -output <carga>/bom.json`, `cyclonedx-py environment` (ou `requirements`).
- Sem ferramenta, não monte o SBOM à mão a partir do lockfile: deixe sem `bom.json` e registre a lacuna.

## API HTTP oferecida (OpenAPI)

Se o repositório tem a especificação (contract-first, `src/main/resources/openapi.yaml`, `api/*.yaml`, usada por um gerador), use-a como está: degrau 1. Se não tem, monte um OpenAPI 3 a partir do código.

### Spring MVC e WebFlux

| Onde | O que extrair |
|---|---|
| `@RestController` ou `@Controller` (com `@ResponseBody`) + `@RequestMapping` na classe | Prefixo de caminho da classe |
| `@GetMapping`, `@PostMapping`, `@PutMapping`, `@PatchMapping`, `@DeleteMapping`, `@RequestMapping(method = ...)` | Método e caminho. Vários caminhos ou métodos na mesma anotação: uma operação para cada |
| `server.servlet.context-path`, `spring.mvc.servlet.path`, `spring.webflux.base-path` (no `application.yml` padrão, não num perfil) | Prefixo de todos os caminhos |
| `RouterFunction` (`route(GET("/x"), handler)`, `RouterFunctions.route()...`) | Rotas funcionais do WebFlux |
| Interface gerada (`implements OrdersApi`) | Siga até a interface: as anotações estão nela |
| `@PathVariable`, `@RequestParam`, `@RequestHeader` | `parameters`, com `in`, `required` (padrão `true`, exceto com `required = false` ou `defaultValue`) e o tipo |
| `@RequestBody` e o tipo do parâmetro | `requestBody`, com o schema do DTO em `components.schemas` |
| Retorno: `T`, `ResponseEntity<T>`, `Mono<T>`, `Flux<T>` (array), `void` | Resposta de sucesso. Status de `@ResponseStatus` ou do `ResponseEntity.status(...)`/`created(...)` literal; sem nada, `200` |
| `@ExceptionHandler` em `@ControllerAdvice` ou no controller | Respostas de erro, com o status e o corpo |
| Nome do método Java | `operationId` (é o que o springdoc usaria) |
| Javadoc ou `@Operation(summary = ...)` | `summary` |
| `@OpenAPIDefinition(info = @Info(title, description, version))` na classe da aplicação ou numa configuração, ou um bean `OpenAPI` | `info.title` e `info.description`, que nomeiam a API no grafo. Leia a classe da aplicação e as `@Configuration` antes dos controllers |

**Anotações do springdoc e do Swagger** (`@Operation`, `@ApiResponses`/`@ApiResponse`, `@Parameter`, `@Schema`, `@Tag`) são a melhor fonte quando existem: elas dizem o que o springdoc publicaria. Use os status, as descrições e os tipos delas (`@Schema(implementation = X.class)`) em vez de deduzir do retorno.

Schemas dos DTOs: os campos do record ou da classe (getters, ou campos com Lombok `@Data`/`@Getter`), com o tipo JSON (`String` → `string`, `int`/`long` → `integer`, `BigDecimal`/`double` → `number`, `boolean`, `List<T>` → `array`, `enum` → `enum` com os valores, `LocalDate` → `string` com `format: date`, `Instant`/`OffsetDateTime` → `date-time`, `UUID` → `uuid`). `required` pelos `@NotNull`, `@NotBlank`, `@NotEmpty`; `@Size`, `@Min`, `@Max`, `@Pattern` viram `minLength`/`maxLength`, `minimum`, `maximum`, `pattern`. `@JsonProperty` muda o nome do campo; `@JsonIgnore` o tira.

Ficam de fora: `/actuator/**`, `/error`, rotas do próprio springdoc/swagger-ui e controllers de teste. Tipo que não dá para resolver (`Map<String, Object>`, genérico aninhado, `Object`) vira `{ "type": "object" }` e uma lacuna.

### Outras stacks

| Stack | Onde |
|---|---|
| Fastify | `fastify.get/post/...`, `fastify.route({ method, url })`, prefixo do `register(plugin, { prefix })`; schema da rota (`schema: { body, params, querystring, response }`) quando houver |
| Express | `app.get/post/...`, `router.<método>`, prefixo de `app.use('/prefixo', router)` |
| NestJS | `@Controller('prefixo')` + `@Get()`, `@Post()`...; DTOs com `class-validator` |
| Go | `http.HandleFunc`/`mux.Handle` (padrão `"GET /orders/{id}"` no Go 1.22+), `chi` (`r.Get`, `r.Route`), `gin` (`r.GET`, `r.Group`), `echo` |
| FastAPI | `@app.get`, `@router.post`, `APIRouter(prefix=...)`, modelos Pydantic. A especificação sai pronta se a pessoa permitir rodar `app.openapi()` |
| Flask | `@app.route(..., methods=[...])`, `Blueprint(url_prefix=...)` |

## Eventos publicados e consumidos (AsyncAPI)

O grafo lê só o **endereço do canal** e a **direção**. O payload é opcional: inclua se o tipo da mensagem for óbvio, porque ajuda quem lê o contrato.

| Onde | Direção |
|---|---|
| `@KafkaListener(topics = ...)`, `@RabbitListener(queues = ...)`, `@JmsListener(destination = ...)`, `@SqsListener` | `receive` |
| `KafkaTemplate.send(topico, ...)`, `RabbitTemplate.convertAndSend(exchange, routingKey, ...)`, `JmsTemplate.convertAndSend(destino, ...)` | `send` |
| Spring Cloud Stream: bean `Consumer`/`Function`/`Supplier` + `spring.cloud.stream.bindings.<função>-in-0.destination` (`receive`) e `-out-0.destination` (`send`) | Pela binding |
| `StreamBridge.send("binding", ...)` + `spring.cloud.stream.bindings.<binding>.destination` | `send` |
| Node: `kafkajs` (`producer.send({ topic })`, `consumer.subscribe({ topic })`), `amqplib` (`publish`, `sendToQueue`, `consume`) | Pela chamada |
| Go: `sarama`, `franz-go`, `segmentio/kafka-go` (`Writer{Topic}`, `Reader{Topic}`) | Pela chamada |
| Python: `confluent-kafka`, `aiokafka` (`produce(topic)`, `subscribe([topic])`), `pika` | Pela chamada |

**Placeholders.** `topics = "${app.kafka.order-created}"` e `@Value("${...}")`: resolva pelo `application.yml` padrão, inclusive o valor default (`${app.topic:orders.created}` vale `orders.created`). Se o valor só existir num perfil, numa variável de ambiente, num ConfigMap ou num values do Helm, o canal vai para as lacunas com o nome da propriedade e onde o valor deveria estar. Nunca deixe `${...}` no endereço: o tradutor descarta o canal. Se o nome muda por ambiente, registre: o grafo guarda um endereço só, o da configuração padrão.

**Filas e exchanges.** No RabbitMQ, quem consome lê uma fila; quem publica escreve num exchange com uma routing key. Use o nome da fila no `receive` e o do exchange no `send`, e registre no `LACUNAS.md` a ligação entre os dois quando a declaração (`Binding`, `@QueueBinding`) estiver no código.

## Clientes HTTP (quem o componente chama)

| Onde | Grupo, serviço e operações |
|---|---|
| `@FeignClient(name = ..., url = ..., path = ...)` + métodos com `@GetMapping`... | `group` pelo `name`; operações pelos métodos |
| `@HttpExchange` / `@GetExchange`... em interfaces, `@ImportHttpServices(group = ...)` | `group` pelo grupo; operações pelos métodos |
| `RestTemplate`, `RestClient`, `WebClient` com base URL de uma propriedade | `baseUrlProperty` pela propriedade; operações pelas chamadas com caminho literal (`.get().uri("/products/{id}", id)`) |
| Node: `axios.create({ baseURL })`, `fetch(\`${BASE}/x\`)`, clientes gerados | Pela base e pelas chamadas |
| Go: `http.NewRequest(método, base+"/x")`, clientes gerados | Pela base e pelas chamadas |
| Python: `requests`, `httpx` com base de configuração | Pela base e pelas chamadas |

**Cliente que a tabela não cobre.** O projeto pode registrar clientes de um jeito próprio: uma biblioteca interna, uma anotação que não é das listadas, um bean montado numa `@Configuration`. Não parta do código para adivinhar: parta da configuração, que diz para onde o componente fala.

1. Procure os destinos nos arquivos de configuração e de implantação: `application*.yml`/`.properties`, `.env*`, values do Helm, manifests do Kubernetes, `docker-compose.yml`. Os sinais são propriedades e variáveis com URL ou host (`*.url`, `*.base-url`, `*.host`, `*_URL`, `*_HOST`, `*_ENDPOINT`), nomes de serviço para descoberta (`lb://<serviço>`, `http://<serviço>:<porta>`) e blocos de configuração por cliente (`spring.cloud.openfeign.client.config.<nome>.url`).
2. Siga cada propriedade até o código que a lê (`@Value`, `@ConfigurationProperties`, `process.env`, `os.Getenv`) e daí até a interface ou a classe que faz as chamadas. As operações saem dos métodos dela.
3. Se o código declara o destino por um atributo (um nome de serviço, um prefixo de caminho numa anotação que não está na tabela), leia o que ele diz, mas só o use se a configuração ou a documentação da biblioteca confirmar o significado. Sem confirmação, o cliente entra com o que é certo (o tipo, o arquivo, as operações) e o destino vira lacuna.

O destino vem do host da base URL na configuração padrão: `http://catalog-api-v1:8080` é o `group` `catalog-api-v1`, o `service` `catalog-api` e a `version` `1`. Se a base URL tem caminho (`http://catalog-api:8080/v1`), ele vai no começo do `path` de cada operação (`/v1/products/{id}`): o caminho da operação é o que o provedor vê. Se a URL só existe num perfil ou numa variável de ambiente, o `group` é o que o código ou o `name` do cliente disser, e o host vai para as lacunas. Chamada com caminho montado (`"/x/" + tipo + "/y"`) entra com a variável entre chaves só se o formato for claro (`/x/{tipo}/y`); senão, lacuna.

Cada cliente leva `source` (o arquivo do cliente) e cada operação, `function` (o método que faz a chamada). Chamadas a serviços de fora da organização (gateway de pagamento, APIs públicas) entram como cliente do mesmo jeito.

## Versões de APIs e tópicos

Quando uma API ou um tópico tem versões que convivem (a v1 ainda servida enquanto os consumidores migram para a v2), o grafo guarda um nó por versão, e é assim que responde "quem ainda consome a v1?". Por isso, **sempre que você identificar a versão de uma operação, de uma API ou de um tópico, informe-a na carga**, não importa o padrão em que ela apareça: no caminho, no host, no nome do tópico, num cabeçalho, no media type, no nome do tipo da mensagem, numa anotação ou numa propriedade. Interface sem versão é o caso comum: não invente uma.

A versão vai no formato `v<N>` (só a maior: `v2`, e não `2.1.0`). A release do componente (`info.version`, a versão do artefato) não é versão da interface. Se a versão que você achou não tem esse formato, ou você não tem certeza de que ela separa interfaces que convivem, registre no `LACUNAS.md` em vez de declarar.

**Onde declarar.** O tradutor reconhece sozinho a versão no primeiro segmento do caminho (`/v2/orders`), no nome do serviço que o cliente chama (`catalog-api-v2`) e no fim do nome do tópico (`order-created.v2`, `order-created-v2`). Fora disso, ou para deixar explícito, declare:

| O que tem versão | Onde declarar |
|---|---|
| Uma operação oferecida | `x-panorama-graph-version` na operação do `openapi.json` (ou no path item, quando vale para todas as operações dele) |
| A API oferecida inteira | `x-panorama-graph-version` em `info` do `openapi.json` |
| Um tópico | `x-panorama-graph-version` no canal do `asyncapi.json` |
| Uma operação chamada por um cliente | `version` na operação do `http-clients.json` |
| O serviço que o cliente chama, pelo host | No cliente: `group` com o nome do host (`catalog-api-v2`), `service` sem a versão (`catalog-api`) e `version` (`2`) |

Mantenha os caminhos como o provedor os vê, com o prefixo de versão quando houver: o do controller, o `context-path`, o caminho da base URL do cliente (`http://catalog-api:8080/v2` faz as operações começarem em `/v2/...`). Não tire o prefixo para "limpar" o caminho.

**Versão no host, do lado do provedor.** Quando cada versão é um serviço exposto à parte (`orders-api-v2.example.com`), o código do provedor normalmente não sabe disso: o nome de serviço continua sem a versão, e o OpenAPI não a traz. Quem afirma que o componente expõe a v2 é a implantação (o Service `orders-api-v2` que seleciona os pods dele), lida pelo `graph-deployments`. Se o repositório tem os manifestos ou os values do Helm com esse nome, anote no `DESCOBERTA.md` e veja em [organizacao.md](organizacao.md#versões-expostas-na-infraestrutura) como levá-la à carga. Não ponha a versão do host no nome de serviço nem nas operações do provedor.

**Quando os lados discordam** (o cliente chama a v2, e o provedor que você leu não tem v2): não "corrija" um lado para casar com o outro. Use o que cada repositório diz e registre a diferença no `LACUNAS.md`.

Anote no `DESCOBERTA.md` de cada componente as versões que encontrou e de onde vieram (o arquivo e a linha do prefixo, da anotação, da propriedade ou do nome).

## Dados (coleções e tabelas)

| Onde | O que extrair |
|---|---|
| JPA: `@Entity` + `@Table(name)` (sem `@Table`, o nome da classe); Spring Data `JpaRepository<Entidade, Id>` | `relational`, `table`; leitura e escrita pelos métodos do repositório usados no código |
| Spring Data MongoDB: `@Document(collection)`, `MongoRepository`, `MongoTemplate` | `document`, `collection` |
| Spring Data JDBC/R2DBC, `JdbcTemplate` com SQL literal | `relational`, `table` pela tabela no SQL |
| Redis (`RedisTemplate`, `@RedisHash`) | `key-value` |
| Node: Prisma (`schema.prisma`, `model X` com `@@map`), TypeORM (`@Entity`), Mongoose (`model('X', schema)`), Drizzle | Pelo modelo |
| Go: GORM (`TableName()`), `sqlx`/`database/sql` com SQL literal, `mongo-driver` (`Collection("x")`) | Pelo modelo ou pela chamada |
| Python: SQLAlchemy (`__tablename__`), Django (`Meta.db_table`), `pymongo` | Pelo modelo ou pela chamada |

`declaredIn: project` só para o tipo do próprio componente (vira dono do dataset). Cada acesso leva o arquivo e a linha da chamada. SQL montado em execução, `EntityManager` com string dinâmica e driver direto sem nome literal vão em `unresolved`, com o motivo. Migrações (`db/migration`, `migrations/`) confirmam nomes de tabela, mas não são acesso.

O servidor de banco em que o dataset está, e em que ambiente, é infraestrutura e configuração: veja [organizacao.md](organizacao.md).

## Contratos de consumidor (Pact)

Pacts que o repositório já tem (`pacts/`, `build/pacts/`, `target/pacts/`) vão como estão para `pacts/`. Não gere pact: ele é resultado de teste.
