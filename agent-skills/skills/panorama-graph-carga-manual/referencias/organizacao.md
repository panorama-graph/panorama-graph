# Organização, catálogo e infraestrutura

O que não sai do build (de quem é cada componente, em que domínio e sistema está, que banco e que broker usa em cada ambiente) vai em YAML para o `graph-seed`, um arquivo por assunto em `carga-grafo/organizacao/`. O modelo completo (tipos de nó, relações, propriedades e valores fixos) está em `GET <api>/v1/schema`: consulte-o quando um caso não estiver aqui.

## Formato

Cada item de `snapshots` é um retrato: tudo o que uma fonte afirma num escopo.

```yaml
snapshots:
  - source: service-catalog
    scope: { catalog: example }
    evidenceBase: "shop/orders-api@3f2c9e1a7b:"   # repositório@commit: de onde as evidências abaixo saíram
    nodes:
      - { key: domain:shop, name: Loja, evidence: README.md#L3 }
      - { key: system:shop/orders, name: Pedidos, evidence: README.md#L5 }
      - { key: component:shop/orders-api, kind: service, name: orders-api, evidence: README.md#L1 }
    relations:
      - { type: PART_OF, from: system:shop/orders, to: domain:shop, evidence: README.md#L5 }
      - { type: PART_OF, from: component:shop/orders-api, to: system:shop/orders, evidence: README.md#L5 }
      - { type: OWNED_BY, from: component:shop/orders-api, to: group:orders-team, evidence: CODEOWNERS#L1 }
```

- **O tipo vem do prefixo da chave** (`group:` é `Group`). Os demais campos do item são propriedades; uma propriedade ou um valor fora do modelo recusa o retrato inteiro.
- **Toda afirmação tem evidência:** o `evidence` do item, o do retrato, ou o `evidenceBase` concatenado com o do item. Com fatos de repositórios diferentes no mesmo retrato, ponha o `repositório@commit:` no `evidence` de cada item, em vez do `evidenceBase`.
- **Uma relação pode apontar para um nó que ninguém declarou** (`group:orders-team` acima, `tech:postgresql`): ele aparece como referenciado. Melhor isso do que declarar um time sem evidência.

## Fontes e escopos

Use as mesmas dos adaptadores que um dia vão substituir esta carga:

| Arquivo | Fonte | Escopo | Assunto |
|---|---|---|---|
| `catalogo.yaml` | `service-catalog` | `{ catalog: <organização> }` | `Domain`, `System`, `PART_OF`, `OWNED_BY`; componentes de infraestrutura (`kind: infra`) |
| `diretorio.yaml` | `directory` | `{ tenant: <organização> }` | `OrgLevel`, `Group`, `AT_LEVEL`, `Person`, `PART_OF` entre grupos, `MEMBER_OF` |
| `infra-<ambiente>.yaml` | `k8s-infra` | `{ cluster: <ambiente> }` | `Environment`, `Resource` (servidores, brokers, bancos), `IN_ENVIRONMENT`, `RUNS`, `HOSTED_ON` |
| `config-<componente>.yaml` | `service-config` | `{ component: <caminho>, environment: <ambiente> }` | `USES_RESOURCE` (o componente usa o banco, o broker), `HOSTED_ON` (o banco no servidor, o tópico no broker) |
| `implantacao-<namespace>.yaml` | `k8s-deployments` | `{ cluster: <ambiente>, namespace: <namespace> }` | Só as versões expostas na infraestrutura: `Api` com `version`, `PROVIDES`, `VERSION_OF` (veja abaixo) |

**Cada envio substitui o retrato anterior da mesma fonte e escopo, e o que sumiu vira `stale`.** O catálogo e o diretório são um retrato só para a organização inteira: se você já importou três repositórios e agora importa mais dois, o `catalogo.yaml` precisa ter os cinco. Antes de gerar, veja se a pasta de carga já tem os arquivos de uma rodada anterior e acrescente a eles; com o grafo no ar, `sources_status` mostra os escopos que já existem. Já o `service-config` é por componente e ambiente, e não interfere nos outros.

## Onde procurar

| Fato | Onde | Cuidado |
|---|---|---|
| Dono (`OWNED_BY`) | `CODEOWNERS` (a regra `*` ou a da raiz), `catalog-info.yaml` (`spec.owner`), `Chart.yaml` (`maintainers`), `README` ("time responsável") | Um usuário em `CODEOWNERS` não é um time. Sem time explícito, é lacuna: registre o que encontrou como pista |
| Domínio e sistema (`PART_OF`) | `catalog-info.yaml` (`spec.system`, `spec.domain`), README, a estrutura de grupos do Git (`shop/orders/...`) só se a pessoa confirmar que ela reflete o negócio | O grupo do Git é organização do repositório, nem sempre do negócio: pergunte |
| Times e pessoas | `catalog-info.yaml` do tipo `Group`, `CODEOWNERS` (`@org/time`), o diretório que a pessoa indicar | Pessoa só com o login da fonte (`person:<login>`), sem e-mail se ele não estiver na fonte |
| Ambientes | Pastas e arquivos por ambiente (`values-dev.yaml`, `k8s/prd/`, `application-hml.yml`) | O nome é livre (`dev`, `hml`, `prd`); o estágio (`kind`) é fixo: `development`, `test`, `staging`, `production`. Pergunte qual é qual se não for óbvio |
| Servidores, brokers e bancos | Manifestos e values do Helm do repositório (`deploy/`, `helm/`, `k8s/`), `docker-compose.yml` (só se for o ambiente de desenvolvimento de verdade, não o de teste local) | `docker-compose` de teste local não é um ambiente: não vira `env:` |
| Que banco o componente usa | Variáveis de conexão nos values ou no manifesto por ambiente (`MONGODB_URI`, `SPRING_DATASOURCE_URL`, `KAFKA_BOOTSTRAP_SERVERS`) | Do valor, só o servidor e o nome do banco: nunca usuário, senha ou a URL inteira. Evidência é o nome da variável |

## Receitas de chave

Fontes diferentes só falam do mesmo nó se usarem a mesma chave. Resumo das receitas do grafo (a referência completa é o `MODELO.md` do panorama-graph-api):

| Nó | Chave | Exemplo |
|---|---|---|
| `Component` | `component:<caminho do repositório>` | `component:shop/orders-api` |
| `Repository` | `repo:<host>/<caminho>` | `repo:git.example.com/shop/orders-api` |
| `Api` | `api:<serviço>/http`; numa versão, `api:<serviço>/<versão>/http` | `api:orders-api/http`, `api:orders-api/v2/http` |
| `Endpoint` | `endpoint:<serviço>/<MÉTODO> <caminho>`, com os parâmetros sem nome; numa versão do código, `endpoint:<serviço>/<versão>/<MÉTODO> <caminho>` | `endpoint:orders-api/GET /orders/{}` |
| `Topic` | `topic:<endereço do canal>` | `topic:shop.orders.order-created` |
| `Technology` | `tech:<nome>` | `tech:postgresql` |
| `Dataset` | `dataset:<caminho do componente>/<nome>` | `dataset:shop/orders-api/orders` |
| `Resource` | instância `resource:<ambiente>/<nome>`; recurso lógico `resource:<ambiente>/<instância>/<nome>` | `resource:dev/postgres`, `resource:dev/postgres/orders` |
| `Environment` | `env:<ambiente>`, o mesmo nome do primeiro segmento da chave do recurso | `env:dev` |
| `Domain`, `System`, `Group` | o identificador curto na fonte | `domain:shop`, `system:shop/orders`, `group:orders-team` |
| `OrgLevel` | o nome do nível na organização | `level:tribo`, `level:time` |
| `Person` | o login no diretório | `person:maria.silva` |

Valores fixos mais usados: `Component.kind` (`service`, `bff`, `frontend`, `job`, `library`, `infra`), `Resource.kind` (`database-server`, `broker`, `cache`, `gateway`, `ingress`, `database`, `bucket`), `Topic.kind` (`topic`, `queue`), `Environment.kind` (`development`, `test`, `staging`, `production`). `USES_RESOURCE` leva `access`: `read`, `write` ou `read-write`.

Os níveis da estrutura (diretoria, tribo, time) não são valores fixos: cada um é um nó `OrgLevel` com o nome que a organização usa, `order` (a posição de cima para baixo, número) e `team: true` nos níveis cujos grupos são times. Cada grupo aponta para o seu com `AT_LEVEL`. Só declare níveis que a fonte mostra (o diretório, o `catalog-info.yaml` do tipo `Group` com `spec.type`); sem fonte, o grupo fica sem nível, e isso é lacuna, não dedução.

## Infraestrutura e configuração, por exemplo

```yaml
# infra-dev.yaml
snapshots:
  - source: k8s-infra
    scope: { cluster: dev }
    evidence: "shop/orders-api@3f2c9e1a7b:deploy/values-dev.yaml"
    nodes:
      - { key: env:dev, kind: development, name: dev }
      - { key: resource:dev/postgres, kind: database-server, name: postgres }
    relations:
      - { type: IN_ENVIRONMENT, from: resource:dev/postgres, to: env:dev }
      - { type: RUNS, from: resource:dev/postgres, to: tech:postgresql, version: "16" }
```

```yaml
# config-orders-api.yaml
snapshots:
  - source: service-config
    scope: { component: shop/orders-api, environment: dev }
    evidenceBase: "shop/orders-api@3f2c9e1a7b:deploy/values-dev.yaml#"
    nodes:
      - { key: resource:dev/postgres/orders, kind: database, name: orders, evidence: env.SPRING_DATASOURCE_URL }
    relations:
      - { type: HOSTED_ON, from: resource:dev/postgres/orders, to: resource:dev/postgres, evidence: env.SPRING_DATASOURCE_URL }
      - { type: USES_RESOURCE, from: component:shop/orders-api, to: resource:dev/postgres/orders, access: read-write, evidence: env.SPRING_DATASOURCE_URL }
```

O `k8s-infra` também é um retrato por ambiente para a organização inteira: o mesmo cuidado do catálogo vale para ele.

## Versões expostas na infraestrutura

Quando cada versão de uma API é um serviço exposto à parte (`orders-api-v2`), quem liga a versão ao componente é a implantação: o `graph-deployments` lê os Services do cluster e, para o Service com a versão no nome que seleciona os pods do componente, afirma a API daquela versão (`PROVIDES`) e que ela é a API do código implantada (`VERSION_OF`). Os endpoints ficam os do código.

Se o cluster já é lido pelo `graph-deployments` (`sources_status` mostra a fonte `k8s-deployments` com o escopo do namespace), não escreva nada: ele já afirma. Se não é, e os manifestos ou os values do Helm do repositório mostram o Service, leve só isso à carga, com a fonte e o escopo do adaptador (o primeiro envio dele substitui o arquivo):

```yaml
# implantacao-orders.yaml
snapshots:
  - source: k8s-deployments
    scope: { cluster: prd, namespace: orders }
    evidence: "shop/orders-api@3f2c9e1a7b:deploy/values-prd.yaml#service.name"
    nodes:
      - { key: api:orders-api/v2/http, kind: http, version: v2, name: orders-api-v2 }
    relations:
      - { type: PROVIDES, from: component:shop/orders-api, to: api:orders-api/v2/http }
      - { type: VERSION_OF, from: api:orders-api/v2/http, to: api:orders-api/http }
```

O nome do cluster e do namespace são os da implantação; sem eles nos manifestos, pergunte ou registre a lacuna.

