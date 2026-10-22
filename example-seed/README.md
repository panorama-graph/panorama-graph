# example-seed

Exemplo de adaptador próprio de uma organização: lê os exports que ela já tem (o diretório de pessoas e o inventário da infraestrutura), traduz para o modelo do grafo e publica os retratos no panorama-graph. É o que carrega os times, as pessoas e a infraestrutura da organização de exemplo (ACME Bank) na instância de exemplo, e é o ponto de partida para quem vai escrever o adaptador da sua organização.

Depende só do SDK publicado (`@panorama-graph/sdk`): copie a pasta para o seu repositório e troque a leitura pela das suas fontes.

## Rodar

```sh
bun install
bun run example-seed data/acme --dry-run          # traduz, confere contra o modelo e mostra o resumo
bun run example-seed data/acme --dry-run --print  # e imprime os retratos em JSON
GRAPH_API_URL=http://localhost:3200 bun run example-seed data/acme
```

Pela imagem (o compose da raiz faz isto no perfil `exemplo`):

```sh
docker build --network host -t example-seed .
docker run --rm --network host -v "$PWD/data/acme:/data:ro" -e GRAPH_API_URL=http://localhost:3200 example-seed /data
```

Saída `0`: tudo enviado, ou a API já tinha um retrato mais novo do escopo, o que não é erro. `1`: erro de uso, de leitura, de tradução ou de conferência (nada é enviado). `2`: a API recusou um retrato; os outros seguem.

## O que lê e o que publica

| Entrada | Fonte (`source`) e escopo | Fatos |
|---|---|---|
| `directory.json`: o export do diretório (os níveis da estrutura, os grupos, as pessoas e de que grupo cada pessoa é, com o cargo) | `directory`, `{tenant}` | `OrgLevel {order, team}`, `Group`, `AT_LEVEL` do grupo para o nível, `Person`, `PART_OF` do grupo para o pai, `MEMBER_OF {role, lead}` |
| `infra.yaml`: o inventário da plataforma (os ambientes, o cluster de cada um, o que é instalado em todos e as rotas de entrada) | `k8s-infra` e `k8s-routes`, `{cluster, namespace}`, dois retratos por ambiente | `Environment`, `Resource` (servidores, broker, cache, ingress e os bancos), `IN_ENVIRONMENT`, `RUNS {version}`, `INSTANCE_OF`, `HOSTED_ON`, `ROUTES {host, path}` |

Cada arquivo é opcional: o que faltar não é enviado, e a API mantém o último retrato daquela fonte.

### directory.json

```json
{
  "tenant": "acme",
  "url": "https://directory.acmebank.example/",
  "levels": [
    { "id": "diretoria", "displayName": "Diretoria", "order": 1 },
    { "id": "superintendencia", "displayName": "Superintendência", "order": 2 },
    { "id": "tribo", "displayName": "Tribo", "order": 3 },
    { "id": "time", "displayName": "Time", "order": 4, "team": true }
  ],
  "groups": [
    { "id": "tribo-credito", "type": "tribo", "displayName": "Tribo de Crédito", "parentId": "superintendencia-produtos-digitais" }
  ],
  "users": [
    { "userName": "juliana.ribeiro", "displayName": "Juliana Ribeiro", "email": "juliana.ribeiro@acmebank.example",
      "memberships": [{ "groupId": "squad-simulacao-credito", "title": "Product Owner", "leader": true }] }
  ]
}
```

Os níveis (`levels`) são os da organização, com o nome que ela usa: o modelo não tem lista fixa. `order` é a posição de cima para baixo (1 é o topo; um nível lateral, como chapter, repete a do vizinho) e dá a cor do nível no organograma do console; `team` marca os níveis cujos grupos são times, os donos dos componentes. O `type` de cada grupo é o id de um nível: um tipo fora dos níveis é erro, e não um palpite. A hierarquia é a do `parentId`, não a da ordem: um time pode ficar direto sob a diretoria.

### infra.yaml

```yaml
environments:
  - { name: dev, stage: development, cluster: acme-dev, namespace: dev }
services:                              # o mesmo conjunto em todos os ambientes
  - name: postgresql
    type: database-server
    engine: { name: postgresql, version: "17" }
    workload: statefulsets/postgresql  # onde o cluster o declara: é a evidência
    component: acme/infra/postgresql   # INSTANCE_OF (opcional)
    databases:
      - { name: acme, declaredIn: "statefulsets/postgresql#env.POSTGRES_DB" }
routes:
  - { ingress: ingress-nginx, name: product-catalog-api, host: "product-catalog-api.{environment}.acmebank.example", path: /, component: acme/credito/product-catalog-api }
```

O nome do ambiente é livre (`hml`, `qa`, `prd`); o estágio (`stage`) é um dos fixos do modelo: `development`, `test`, `staging`, `production`.

## Como está feito

| Arquivo | Papel |
|---|---|
| [src/directory.ts](src/directory.ts) | Export do diretório → retrato `directory`, com os níveis da organização |
| [src/infra.ts](src/infra.ts) | Inventário → retratos `k8s-infra` e `k8s-routes` de cada ambiente |
| [src/check.ts](src/check.ts) | Confere cada retrato contra o modelo do SDK (tipo pelo prefixo, propriedades, valores fixos, pares, obrigatórias, evidência), para o `--dry-run` achar o erro sem a API |
| [src/plan.ts](src/plan.ts) | Lê os arquivos, traduz e confere |
| [src/cli.ts](src/cli.ts) | Opções, resumo, conferência do modelo da API (`assertModel`) e envio |

As regras que todo adaptador segue, e que o exemplo mostra:

- **Chaves pelas receitas do SDK** (`groupKey`, `levelKey`, `personKey`, `environmentKey`, `resourceKey`, `technologyKey`, `componentKey`). Com elas, os fatos deste adaptador caem nos mesmos nós que os dos outros: o `INSTANCE_OF` e o `ROUTES` apontam para os componentes que o `graph-publish` publica do build.
- **Um retrato por fonte e escopo, com tudo o que a fonte viu.** O que sumiu do export vira `stale` no próximo envio. Por isso as rotas de um ambiente sem rotas saem como retrato vazio, e não deixam de ser enviadas.
- **Evidência em todo fato,** apontando o registro que o afirma na fonte (`levels/<id>`, `groups/<id>`, `users/<login>`, o workload no cluster), relativa ao `evidenceBase` do retrato.
- **Nada é inventado.** O que o export não diz não entra: um grupo de nível desconhecido, um pai ou um grupo que não está no export são erros.
- **O modelo é da API.** O SDK traz a versão do modelo em que foi gerado, e o `assertModel()` recusa uma API em outra versão antes de qualquer envio. Ao atualizar a API para um modelo novo, suba a versão do SDK aqui.
- **Retrato mais antigo não é erro.** A API recusa com `outdated_snapshot` o retrato mais antigo que o último do escopo; o adaptador segue para o próximo.

## Para a sua organização

1. Copie esta pasta para um repositório seu. O SDK (`@panorama-graph/sdk`) vem do npm.
2. Troque a leitura dos arquivos ([src/plan.ts](src/plan.ts)) pela das suas fontes: a API do IdP ou do RH (SCIM, LDAP, Workday), o CMDB, o Terraform, o cluster. Os tipos de entrada (`DirectoryExport`, `InfraInventory`) são o ponto de encontro: preencha-os a partir da fonte e a tradução continua a mesma.
3. Preencha os níveis (`levels`) com os da sua estrutura. Se a fonte só traz o tipo de cada grupo, declare os níveis (nome, posição e quais são times) junto da leitura: são a organização falando de si, e entram com a evidência do registro que os define.
4. Escolha a fonte e o escopo de cada retrato pelo sistema de onde os fatos vêm (`directory`, `{tenant}`; `k8s-infra`, `{cluster, namespace}`), e não por quem os carrega: quem consulta o grafo vê a fonte de cada fato. A `source` segue `^[a-z][a-z0-9-]*$`.
5. Rode com `--dry-run` até não haver erro, envie, e envie de novo: a segunda carga só tem `unchanged`.
6. Agende o envio (CronJob, pipeline agendado). Cada envio é o retrato completo do que a fonte tem naquele momento.

O que o grafo aceita (tipos de nó e de relação, propriedades, valores fixos e livres, receitas de chave) está no [MODELO.md](../api/MODELO.md). O que não cabe no modelo é mudança versionada na API, e não neste adaptador.

## Desenvolvimento

```sh
bun run lint   # tsc
bun test       # tradução, conferência e os exports de data/acme
```

O teste dos exports do ACME Bank também confere que os donos do catálogo e os componentes das rotas existem no resto da carga de exemplo (`../adapters`). Fora do monorepo, esse teste é pulado.
