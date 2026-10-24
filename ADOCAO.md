# Adotar os adaptadores

Como uma organização passa a alimentar o grafo com os adaptadores do produto. O guia cobre o que combinar antes, a ordem de implantação, o que cada adaptador exige e como conferir o resultado. Os detalhes de cada adaptador (opções, formatos, regras de tradução) estão no [README dos adaptadores](https://github.com/panorama-graph/panorama-graph-adapters#readme) e no do [plugin Gradle](https://github.com/panorama-graph/panorama-graph-gradle-plugin#readme). Para subir a instância e carregar o exemplo, siga antes os [primeiros passos](PRIMEIROS-PASSOS.md).

## O que cada adaptador cobre

| Assunto | Adaptador | Fonte (`source`) | Onde roda | Quem cuida |
|---|---|---|---|---|
| Arquitetura de build de cada componente: stack, bibliotecas, endpoints, eventos, clientes HTTP, acesso a dados, contratos | Plugin Gradle `panorama-graph` → `graph-receiver` | `build-manifest`, `sbom`, `dependency-usage`, `openapi`, `asyncapi`, `http-clients`, `data-access`, `pact` | No pipeline de cada componente Gradle | Plataforma (template de pipeline) |
| O mesmo, para builds que não são Gradle | `graph-publish` (imagem), ou o pacote por `curl` ao `graph-receiver` | as mesmas | No pipeline de cada componente | Plataforma, ou o time do componente |
| O que roda em cada ambiente, com versão e commit | `graph-deployments` | `k8s-deployments` | No cluster, como CronJob | Plataforma (cluster) |
| Times, pessoas, catálogo de serviços (domínios, sistemas, donos), infraestrutura e rotas | Adaptador próprio, a partir do [example-seed](https://github.com/panorama-graph/panorama-graph-adapters/tree/main/example-seed) | `directory`, `service-catalog`, `k8s-infra`, `k8s-routes`... | Agendado (CronJob, pipeline agendado) | Quem cuida de cada fonte |
| O que ainda não tem adaptador | `graph-seed` (YAML) | a mesma do adaptador que vai substituí-lo | À mão | Arquitetura |

Todos gravam pelo `POST /v1/ingest` da API, um retrato por fonte e escopo. Cada envio substitui o anterior do mesmo escopo, e o que sumiu vira `stale`. A ordem das cargas não importa: uma relação pode apontar para um nó que outra fonte ainda não publicou.

## Experimentar antes de adotar

Para ver o grafo com os próprios repositórios antes de mexer em pipeline ou cluster, um agente de IA pode fazer a carga. A skill [panorama-graph-ingestao](https://github.com/panorama-graph/panorama-graph-skills#readme):
- explora o código e os acessos que o agente tiver (cluster, catálogo, diretório), sem modificar nada;
- monta os retratos com as mesmas fontes e escopos dos adaptadores;
- envia os retratos pela ingestão nativa, depois do dry-run e da confirmação de uma pessoa.

O que ela não encontra (dono, domínio, tópico que só existe no deploy) fica numa lista de lacunas, e não é deduzido. Para projetos Gradle, a skill `panorama-graph-carga-manual` faz o mesmo pelo receptor, com a tradução do plugin.

A carga é um retrato do commit lido. Como usa as fontes e os escopos dos adaptadores, a implantação abaixo a substitui sem limpeza.

## 1. Combinar as convenções

Fatos de fontes diferentes só se encontram quando chegam à mesma chave. Antes do primeiro envio, a organização combina:

| Convenção | Regra | Por que importa |
|---|---|---|
| **Chave do componente** | O nome de serviço (`component:product-api`), único na organização: o `spring.application.name`, o mesmo `service.name` da telemetria. O repositório é outro nó (`repo:<host>/<caminho>`), ligado ao componente por `HOSTED_IN` | É por ela que o build, as implantações, o catálogo, as rotas e a telemetria falam do mesmo componente. O catálogo e o `graph-deployments` precisam usar exatamente esse nome |
| **Nome de serviço** | O nome com que os clientes conhecem o componente: o `spring.application.name`, o participante nos pacts e o grupo dos clientes HTTP | Nomeia a API e os endpoints (`api:<serviço>/http`). Provedor e consumidores só se ligam se usarem o mesmo nome |
| **Branch da linha principal** | Uma branch só por componente publica, a que representa o estado vigente | Duas branches no mesmo escopo trocam os retratos uma da outra a cada build |
| **Ambientes** | O nome de cada ambiente (livre: `dev`, `hml`, `prd`) e o estágio (fixo: `development`, `test`, `staging`, `production`) | O mesmo nome nas implantações, na infraestrutura e nas rotas (`env:<nome>`) |
| **Identificadores de grupos e pessoas** | O identificador curto da fonte (`group:<id>`, `person:<login>`) | Os donos do catálogo (`OWNED_BY`) apontam para os grupos do diretório |
| **Fonte de cada assunto** | O sistema de onde o fato vem (`directory`, `service-catalog`), e não quem o carrega | Quem consulta vê a fonte de cada fato. A carga à mão usa desde já a fonte do adaptador que vai substituí-la |

As receitas de todas as chaves estão no [MODELO.md](api/MODELO.md#receitas-de-chave). Um adaptador próprio as obtém do SDK (`@panorama-graph/sdk`), e não as monta à mão; sem o SDK, segue as regras do [ADAPTADOR.md](api/ADAPTADOR.md#receitas-de-chave).

## 2. Preparar a instalação

- **Instância:** a API e o Neo4j, como no `docker-compose.yml` deste repositório, e o `graph-receiver`, como no do [repositório dos adaptadores](https://github.com/panorama-graph/panorama-graph-adapters). O receptor é o endereço que os pipelines usam (`PANORAMA_GRAPH_URL`); a API é o dos adaptadores que gravam direto (`GRAPH_API_URL`).
- **Autenticação.** Ligue o login pelo SSO da organização (`OIDC_ISSUER`, nos [primeiros passos](PRIMEIROS-PASSOS.md#6-autenticação)): o console passa a exigir a entrada pelo provedor, e o REST e o MCP, um token em `Authorization: Bearer`. Os pipelines usam o OIDC do CI (o emissor em `JWT_ISSUERS`, com a audiência `JWT_AUDIENCE`) ou o `INGEST_TOKEN`. O token ainda não restringe o que cada adaptador escreve: qualquer identidade autenticada grava em qualquer escopo. O receptor (`/v1/builds`) não tem autenticação própria; exponha-o só para a rede dos runners.
- **Artefatos publicados no seu repositório:** o SDK no npm (`@panorama-graph/sdk`), o plugin Gradle e a biblioteca de teste no repositório Maven, e a imagem dos adaptadores (`docker build .` na raiz do [repositório dos adaptadores](https://github.com/panorama-graph/panorama-graph-adapters), com `graph-publish`, `graph-deployments`, `graph-seed` e `graph-receiver`) no registry de imagens.
- **Mesma versão do modelo.** Os CLIs conferem o modelo da API contra o do SDK antes de enviar e param se forem diferentes. Ao atualizar a API, atualize a imagem dos adaptadores e o SDK do adaptador próprio.

## 3. Implantar por etapas

Comece por um piloto: um domínio, os componentes dele e os times donos. Ele mostra, com poucos repositórios, se as convenções fecham (o consumidor encontra o provedor, o dono aparece, o banco aparece no ambiente certo), antes de mexer no template de pipeline de todos.

### 3.1 Esqueleto: organização e catálogo

Sem donos e domínios, o grafo responde quem chama quem, mas não de quem é. Se a organização já tem fontes exportáveis (IdP ou RH, catálogo de serviços, CMDB), comece pelo adaptador próprio (seção 4). Se não, faça a primeira carga à mão com o `graph-seed`, como nos [primeiros passos](PRIMEIROS-PASSOS.md#primeira-carga-à-mão):

```sh
graph-seed carga/ --dry-run   # confere chaves e evidências e mostra o resumo
GRAPH_API_URL=http://graph-api.interno:3200 graph-seed carga/
```

Toda afirmação precisa de evidência: o endereço do registro na fonte (a página do time no diretório, o arquivo no repositório do catálogo). Versione a pasta de carga num repositório: o histórico dela é o histórico das mudanças manuais.

### 3.2 Builds

**Projetos Gradle.** Publique o plugin no seu repositório Maven e aplique-o no template de build (ou no plugin de convenção da organização):

```groovy
plugins {
    id 'java'
    id 'panorama-graph' version '0.3.1'   // já traz o CycloneDX e o dependency-analysis
}
```

No pipeline, o job de testes gera os artefatos e um job seguinte os envia ao receptor:

```yaml
tests:
  script: ./gradlew test architectureArtifacts
  artifacts: { paths: [build/architecture/] }

publish_architecture:
  needs: [{ job: tests, artifacts: true }]
  allow_failure: true
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      variables: { GRAPH_DRY_RUN: "-PpanoramaGraph.dryRun" }
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH                  # a branch da linha principal
  script:
    - ./gradlew architecturePublish -PpanoramaGraph.url="$PANORAMA_GRAPH_URL" $GRAPH_DRY_RUN
```

O build diz o que gerou e, do que não gerou, o motivo. Para ter OpenAPI, AsyncAPI, clientes HTTP e o nome de serviço num projeto Spring, ele precisa de um `@SpringBootTest` (um teste de fumaça basta), de springdoc ou Springwolf e dos clientes HTTP declarativos do Spring Framework 7. O que o projeto não tem como gerar não é enviado, e o grafo mantém o que já tinha daquela fonte.

**Outros builds** (Node, Go, Python, .NET). Gere em `build/architecture/` os arquivos que o build tem como produzir: o `manifest.json` é o único obrigatório; os outros são padrões de fora (CycloneDX, OpenAPI, AsyncAPI, Pact) ou formatos do produto especificados em [panorama-graph-adapters/schemas/](https://github.com/panorama-graph/panorama-graph-adapters/tree/main/schemas). Publique pela imagem dos adaptadores, sem clonar o repositório de novo:

```yaml
publish_architecture:
  image: registry.example.com/panorama-graph-adapters:0.1.0
  needs: [{ job: build, artifacts: true }]
  variables: { GIT_STRATEGY: none }
  allow_failure: true
  script:
    - graph-publish build/architecture --api "$GRAPH_API_URL" --kind frontend   # em MR: --dry-run
```

Sem a imagem, o mesmo diretório vai por `curl` ao receptor ([graph-receiver](https://github.com/panorama-graph/panorama-graph-adapters#graph-receiver)).

**Para não atrapalhar os times:** o job roda com `allow_failure`, valida com dry-run no MR e publica só da branch da linha principal.

### 3.3 Implantações

Para o grafo mostrar a versão que roda em cada ambiente, e não só a linha principal:

1. **Guarde o pacote de cada build que vira imagem**, com o nome do componente e o commit no caminho, num repositório de arquivos. O nome é o do `application.json` do build e, sem ele, o fim do caminho do repositório, a mesma regra do `graph-publish`:

   ```yaml
   publish_architecture_bundle:
     needs: [{ job: tests, artifacts: true }]
     script:
       - COMPONENT=$(jq -r '.name // empty' build/architecture/application.json 2>/dev/null); COMPONENT=${COMPONENT:-$CI_PROJECT_NAME}
       - tar -czf architecture.tar.gz -C build/architecture .
       - curl --fail -u "$USER:$PASSWORD" --upload-file architecture.tar.gz "$BUNDLES_URL/$COMPONENT/$CI_COMMIT_SHA.tar.gz"
   ```

2. **Anote os workloads e os namespaces** no chart ou no template de deploy:

   | Onde | Chave | Valor |
   |---|---|---|
   | Deployment | anotação `panorama-graph.io/component` | Nome do componente, o mesmo do pacote |
   | Deployment | anotação `panorama-graph.io/commit` | Commit da imagem (`$CI_COMMIT_SHA`) |
   | Deployment | label `app.kubernetes.io/version` | Versão (sem ele, a tag da imagem) |
   | Namespace | label `panorama-graph.io/environment` | Nome do ambiente |
   | Namespace | label `panorama-graph.io/environment-kind` | `development`, `test`, `staging` ou `production` |

   Workload sem a anotação de componente fica de fora; sem a de commit, é ignorado com aviso.

3. **Rode o `graph-deployments` no cluster**, com permissão só de leitura:

   ```yaml
   apiVersion: v1
   kind: ServiceAccount
   metadata: { name: graph-deployments, namespace: panorama-graph }
   ---
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRole
   metadata: { name: graph-deployments-read }
   rules:
     - { apiGroups: [apps], resources: [deployments], verbs: [get, list] }
     - { apiGroups: [""], resources: [namespaces], verbs: [get, list] }
   ---
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRoleBinding
   metadata: { name: graph-deployments-read }
   roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: graph-deployments-read }
   subjects: [{ kind: ServiceAccount, name: graph-deployments, namespace: panorama-graph }]
   ---
   apiVersion: batch/v1
   kind: CronJob
   metadata: { name: graph-deployments, namespace: panorama-graph }
   spec:
     schedule: "*/10 * * * *"
     concurrencyPolicy: Forbid
     jobTemplate:
       spec:
         template:
           spec:
             serviceAccountName: graph-deployments
             restartPolicy: Never
             containers:
               - name: graph-deployments
                 image: registry.example.com/panorama-graph-adapters:0.1.0
                 command: [graph-deployments]
                 args: [--cluster, prod-cluster]
                 env:
                   - { name: GRAPH_API_URL, value: "http://graph-api.interno:3200" }
                   - { name: GRAPH_BUNDLE_URL, value: "https://files.example.com/architecture/{component}/{commit}.tar.gz" }
   ```

   Um cluster por CronJob, cada um com o próprio `--cluster`. O commit que roda sem pacote não impede a publicação: aquele componente segue a linha principal no recorte do ambiente.

## 4. Escrever o adaptador próprio

Para as fontes que só a organização tem (diretório de pessoas, catálogo, CMDB, inventário da infraestrutura), copie o [example-seed](https://github.com/panorama-graph/panorama-graph-adapters/tree/main/example-seed#para-a-sua-organização) para um repositório seu. Ele já faz o que é igual para todos: chaves pelas receitas do SDK, conferência contra o modelo no `--dry-run`, evidência em cada fato, um retrato completo por fonte e escopo e o retrato mais antigo tratado como não erro. O que muda é a leitura das fontes (trocar `src/plan.ts`) e os níveis da estrutura (`levels` no export do diretório).

Adaptador pronto, ele substitui a carga à mão do mesmo assunto: o retrato correspondente sai do YAML. Como os dois usam a mesma fonte e o mesmo escopo, o primeiro envio do adaptador já substitui o retrato manual; se a fonte ou o escopo mudarem, envie o retrato antigo uma última vez com as listas vazias, para os fatos manuais virarem `stale`.

Uma linguagem diferente de TypeScript também serve: o contrato é o `POST /v1/ingest` e o modelo em `GET /v1/schema`. Sem o SDK, as receitas de chave precisam ser reproduzidas exatamente: o [ADAPTADOR.md](api/ADAPTADOR.md) traz o ciclo de uma carga, as receitas como regras (com os casos de teste em [sdks/key-recipes.json](sdks/key-recipes.json)) e um exemplo de carga para cada relação.

## 5. Conferir

| O quê | Como |
|---|---|
| Cada adaptador antes do primeiro envio | `--dry-run` (no plugin, `-PpanoramaGraph.dryRun`): monta os retratos, mostra o resumo e não grava |
| A carga é estável | Envie duas vezes seguidas: a segunda só tem `unchanged` |
| De onde vem cada fato, e o que nenhuma fonte cobre | Página **Fontes** do console, ou a consulta `sources_status` |
| As convenções fecharam | Na ficha de um componente do piloto, o dono, o sistema, os consumidores (pelo Pact e pelos clientes HTTP), os bancos e o ambiente aparecem, cada um com o selo da sua fonte |
| O consumidor encontrou o provedor | `api_consumers` do provedor lista o consumidor. Se não listar, os dois usam nomes de serviço diferentes |

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Saída `1` antes de qualquer envio, com a versão do modelo | API e adaptador em versões diferentes do modelo: atualize a imagem ou o SDK |
| Saída `2`, `invalid_snapshot` | Uma propriedade, um valor ou um par de relação fora do modelo. O retrato inteiro é recusado; os outros seguem. Os erros são impressos |
| `outdated` | A API já tem um retrato mais novo daquele escopo. Não é erro |
| Dois nós para o mesmo componente | Chaves diferentes: o catálogo ou as anotações do cluster usam outro caminho de repositório, ou o provedor e o consumidor, outro nome de serviço |
| Fatos que somem e voltam a cada build | Duas branches publicando no mesmo escopo |
| Componente removido continua nas consultas | As fontes dele pararam de publicar. Aposente o escopo (`POST /v1/scopes/retire`) |
| Um artefato não aparece no build | O plugin diz o motivo no fim do build (plugin de SBOM não aplicado, sem `@SpringBootTest`, sem springdoc...) |
