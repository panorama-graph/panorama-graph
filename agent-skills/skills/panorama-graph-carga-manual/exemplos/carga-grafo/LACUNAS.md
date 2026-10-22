# Lacunas

O que a carga não afirma por falta de evidência. Cada item diz o que foi visto e o que falta para resolver.

| Componente | O quê | Visto | Para resolver |
|---|---|---|---|
| orders-api | Dono | `CODEOWNERS` lista só `@ana.souza`, uma pessoa | Qual time é o dono? Entra como `OWNED_BY` no `catalogo.yaml` |
| orders-api | Bibliotecas | — | Autorizar o CycloneDX (`mvn org.cyclonedx:cyclonedx-maven-plugin:makeBom` com saída fora do repositório) |
| orders-api | `GET /orders/export` | `ReportController.java#L18`: caminho montado com `"/orders/" + formato` | Confirmar se o caminho é `/orders/{formato}` |
| orders-api | Tópico em produção | `application-prd.yml` sobrescreve `app.topics.order-placed` com `${ORDER_TOPIC}` | O grafo guarda o endereço da configuração padrão; o de produção vem da variável no deploy |
