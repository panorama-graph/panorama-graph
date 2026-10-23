// Gerado por `bun run sdk:generate` no panorama-graph-api, a partir de src/model (o mesmo documento do GET /v1/schema). Não edite à mão.

/** Versão do modelo do grafo: tipos de nó, de relação e propriedades que a API aceita na carga. */
export const MODEL_VERSION = 12;

/** Formato das chaves: o prefixo determina o tipo do nó. */
export const KEY_FORMAT = "<prefixo>:<identificador>";

/** Tipos de nó, com o prefixo da chave e as propriedades. */
export const NODE_TYPES = {
  "Domain": {
    "prefix": "domain",
    "description": "Domínio de negócio",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      }
    }
  },
  "System": {
    "prefix": "system",
    "description": "Conjunto de componentes que entregam uma capacidade",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      }
    }
  },
  "Component": {
    "prefix": "component",
    "description": "Unidade implantável",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "kind": {
        "type": "string",
        "enum": [
          "service",
          "bff",
          "frontend",
          "job",
          "library",
          "infra"
        ],
        "description": "Subtipo: service, bff, frontend, job, library, infra"
      }
    }
  },
  "Repository": {
    "prefix": "repo",
    "description": "Repositório de código",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "url": {
        "type": "string",
        "description": "URL do repositório"
      }
    }
  },
  "Api": {
    "prefix": "api",
    "description": "Interface oferecida. Duas versões que convivem (v1 e v2) são duas APIs",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "kind": {
        "type": "string",
        "enum": [
          "http",
          "event"
        ],
        "description": "Subtipo: http, event"
      },
      "version": {
        "type": "string",
        "description": "Versão maior da interface (v1, v2): a declarada pela fonte ou, pela convenção, a do primeiro segmento do caminho, a do nome do serviço no host (servico-xpto-v2) ou a do fim do nome do tópico. Ausente quando a interface não é versionada"
      }
    }
  },
  "Endpoint": {
    "prefix": "endpoint",
    "description": "Operação de uma API HTTP",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "method": {
        "type": "string",
        "description": "Método HTTP"
      },
      "path": {
        "type": "string",
        "description": "Caminho, com parâmetros entre chaves"
      },
      "operationId": {
        "type": "string",
        "description": "Identificador da operação no contrato (operationId do OpenAPI)"
      },
      "contract": {
        "type": "string",
        "description": "Contrato da operação em JSON: format, parameters, requestBody, responses e, em components, o fecho dos $ref locais (schemas, parameters, responses, requestBodies), como no documento de origem"
      }
    }
  },
  "Topic": {
    "prefix": "topic",
    "description": "Canal de eventos: tópico (cada assinante recebe todas as mensagens) ou fila (cada mensagem vai para um só consumidor). Cada versão é um canal, com o próprio nome",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "kind": {
        "type": "string",
        "enum": [
          "topic",
          "queue"
        ],
        "description": "Subtipo: topic, queue"
      },
      "version": {
        "type": "string",
        "description": "Versão maior da interface (v1, v2): a declarada pela fonte ou, pela convenção, a do primeiro segmento do caminho, a do nome do serviço no host (servico-xpto-v2) ou a do fim do nome do tópico. Ausente quando a interface não é versionada"
      }
    }
  },
  "Contract": {
    "prefix": "contract",
    "description": "Especificação ou contrato",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "kind": {
        "type": "string",
        "enum": [
          "openapi",
          "asyncapi",
          "pact",
          "schema"
        ],
        "description": "Subtipo: openapi, asyncapi, pact, schema"
      },
      "url": {
        "type": "string",
        "description": "Onde o contrato está publicado"
      }
    }
  },
  "Resource": {
    "prefix": "resource",
    "description": "Infraestrutura: instância (servidor, broker, gateway) ou recurso lógico (banco, bucket)",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "kind": {
        "type": "string",
        "enum": [
          "database-server",
          "broker",
          "cache",
          "gateway",
          "ingress",
          "database",
          "bucket"
        ],
        "description": "Subtipo: database-server, broker, cache, gateway, ingress, database, bucket"
      }
    }
  },
  "Group": {
    "prefix": "group",
    "description": "Time ou unidade organizacional",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      }
    }
  },
  "OrgLevel": {
    "prefix": "level",
    "description": "Nível da estrutura organizacional, no vocabulário da organização (diretoria, tribo, time). Cada grupo diz o seu nível por AT_LEVEL",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "order": {
        "type": "number",
        "description": "Posição de cima para baixo na estrutura (1 é o topo). Níveis laterais, como chapters, repetem a posição"
      },
      "team": {
        "type": "boolean",
        "description": "Os grupos deste nível são times: entregam e são donos de componentes"
      }
    }
  },
  "Person": {
    "prefix": "person",
    "description": "Pessoa",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "email": {
        "type": "string",
        "description": "E-mail"
      }
    }
  },
  "Technology": {
    "prefix": "tech",
    "description": "Linguagem, runtime ou framework",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      }
    }
  },
  "Library": {
    "prefix": "lib",
    "description": "Pacote de dependência (coordenadas sem versão)",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      }
    }
  },
  "Dataset": {
    "prefix": "dataset",
    "description": "Estrutura de dados (coleção, tabela, visão), identificada pelo componente que a mapeia",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "kind": {
        "type": "string",
        "enum": [
          "collection",
          "table",
          "view"
        ],
        "description": "Subtipo: collection, table, view"
      },
      "store": {
        "type": "string",
        "enum": [
          "relational",
          "document",
          "key-value",
          "wide-column",
          "search",
          "graph",
          "time-series",
          "object"
        ],
        "description": "Categoria do banco: relational, document, key-value, wide-column, search, graph, time-series, object"
      }
    }
  },
  "Environment": {
    "prefix": "env",
    "description": "Ambiente em que a infraestrutura e os componentes estão implantados (desenvolvimento, homologação, produção)",
    "props": {
      "name": {
        "type": "string",
        "description": "Nome legível"
      },
      "description": {
        "type": "string",
        "description": "Descrição curta"
      },
      "kind": {
        "type": "string",
        "enum": [
          "development",
          "test",
          "staging",
          "production"
        ],
        "description": "Subtipo: development, test, staging, production"
      }
    }
  }
} as const;

/** Tipos de relação, com os pares válidos, as propriedades e as de identidade. */
export const RELATION_TYPES = {
  "PART_OF": {
    "description": "Pertence a",
    "nature": "estrutura",
    "pairs": [
      {
        "from": "System",
        "to": "Domain"
      },
      {
        "from": "Component",
        "to": "System"
      },
      {
        "from": "Group",
        "to": "Group"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "OWNED_BY": {
    "description": "É de responsabilidade de",
    "nature": "organização",
    "pairs": [
      {
        "from": "Component",
        "to": "Group"
      },
      {
        "from": "System",
        "to": "Group"
      },
      {
        "from": "Domain",
        "to": "Group"
      },
      {
        "from": "Api",
        "to": "Group"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "MEMBER_OF": {
    "description": "Pessoa é membro do grupo",
    "nature": "organização",
    "pairs": [
      {
        "from": "Person",
        "to": "Group"
      }
    ],
    "props": {
      "role": {
        "type": "string",
        "description": "Papel no grupo"
      },
      "lead": {
        "type": "boolean",
        "description": "Lidera o grupo"
      }
    },
    "identityProps": []
  },
  "AT_LEVEL": {
    "description": "Grupo está no nível da estrutura organizacional",
    "nature": "organização",
    "pairs": [
      {
        "from": "Group",
        "to": "OrgLevel"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "HOSTED_IN": {
    "description": "Código do componente está no repositório",
    "nature": "estrutura",
    "pairs": [
      {
        "from": "Component",
        "to": "Repository"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "PROVIDES": {
    "description": "Componente oferece a API",
    "nature": "lógica",
    "pairs": [
      {
        "from": "Component",
        "to": "Api"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "HAS_ENDPOINT": {
    "description": "API tem a operação",
    "nature": "estrutura",
    "pairs": [
      {
        "from": "Api",
        "to": "Endpoint"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "CONSUMES": {
    "description": "Componente consome a API",
    "nature": "lógica",
    "pairs": [
      {
        "from": "Component",
        "to": "Api"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "CALLS": {
    "description": "Componente chama a operação",
    "nature": "lógica",
    "pairs": [
      {
        "from": "Component",
        "to": "Endpoint"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "PUBLISHES": {
    "description": "Componente publica no tópico",
    "nature": "lógica",
    "pairs": [
      {
        "from": "Component",
        "to": "Topic"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "SUBSCRIBES": {
    "description": "Componente consome do tópico",
    "nature": "lógica",
    "pairs": [
      {
        "from": "Component",
        "to": "Topic"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "VERSION_OF": {
    "description": "API versionada na infraestrutura (o serviço exposto com a versão no nome, servico-xpto-v2) é a API do código implantada sob esse nome: os endpoints são os da API do código",
    "nature": "física",
    "pairs": [
      {
        "from": "Api",
        "to": "Api"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "SPECIFIED_BY": {
    "description": "Especificado pelo contrato",
    "nature": "contrato",
    "pairs": [
      {
        "from": "Api",
        "to": "Contract"
      },
      {
        "from": "Topic",
        "to": "Contract"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "USES_RESOURCE": {
    "description": "Componente usa o recurso",
    "nature": "lógica",
    "pairs": [
      {
        "from": "Component",
        "to": "Resource"
      }
    ],
    "props": {
      "access": {
        "type": "string",
        "enum": [
          "read",
          "write",
          "read-write"
        ],
        "description": "Tipo de acesso"
      }
    },
    "identityProps": []
  },
  "HOSTED_ON": {
    "description": "Recurso lógico está na instância; tópico está no broker",
    "nature": "física",
    "pairs": [
      {
        "from": "Resource",
        "to": "Resource"
      },
      {
        "from": "Topic",
        "to": "Resource"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "INSTANCE_OF": {
    "description": "Instância é a implantação, num ambiente, do componente de infraestrutura",
    "nature": "física",
    "pairs": [
      {
        "from": "Resource",
        "to": "Component"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "IN_ENVIRONMENT": {
    "description": "Recurso está no ambiente: a instância, ou o recurso lógico quando a fonte o afirma direto",
    "nature": "física",
    "pairs": [
      {
        "from": "Resource",
        "to": "Environment"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "DEPLOYED_IN": {
    "description": "Componente está implantado no ambiente, numa versão. Uma afirmação por commit em execução (duas no canário ou no blue-green)",
    "nature": "física",
    "pairs": [
      {
        "from": "Component",
        "to": "Environment"
      }
    ],
    "props": {
      "version": {
        "type": "string",
        "required": true,
        "description": "Versão do artefato em execução (rótulo, ex.: 1.4.0 ou 1.5.0-RC.2)"
      },
      "commit": {
        "type": "string",
        "required": true,
        "description": "Commit de que o artefato em execução foi construído"
      },
      "image": {
        "type": "string",
        "description": "Imagem em execução"
      },
      "replicas": {
        "type": "string",
        "description": "Réplicas pedidas"
      }
    },
    "identityProps": [
      "commit"
    ]
  },
  "RUNS": {
    "description": "Instância roda a tecnologia",
    "nature": "stack",
    "pairs": [
      {
        "from": "Resource",
        "to": "Technology"
      }
    ],
    "props": {
      "version": {
        "type": "string",
        "description": "Versão"
      }
    },
    "identityProps": []
  },
  "ROUTES": {
    "description": "Gateway ou ingress encaminha para o componente",
    "nature": "física",
    "pairs": [
      {
        "from": "Resource",
        "to": "Component"
      }
    ],
    "props": {
      "host": {
        "type": "string",
        "required": true,
        "description": "Host da rota"
      },
      "path": {
        "type": "string",
        "description": "Prefixo de caminho da rota"
      }
    },
    "identityProps": [
      "host",
      "path"
    ]
  },
  "REACHES_VIA": {
    "description": "Componente chega a outros pelo gateway ou ingress",
    "nature": "física",
    "pairs": [
      {
        "from": "Component",
        "to": "Resource"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "BUILT_WITH": {
    "description": "Componente é construído com a tecnologia",
    "nature": "stack",
    "pairs": [
      {
        "from": "Component",
        "to": "Technology"
      }
    ],
    "props": {
      "version": {
        "type": "string",
        "description": "Versão"
      }
    },
    "identityProps": []
  },
  "DEPENDS_ON": {
    "description": "Componente depende da biblioteca",
    "nature": "stack",
    "pairs": [
      {
        "from": "Component",
        "to": "Library"
      }
    ],
    "props": {
      "version": {
        "type": "string",
        "description": "Versão"
      },
      "scope": {
        "type": "string",
        "description": "Classpath em que a dependência está (compile, runtime, test...)"
      },
      "resolved": {
        "type": "boolean",
        "description": "Versão resolvida pelo build (e não só declarada)"
      },
      "direct": {
        "type": "boolean",
        "description": "Dependência direta do componente (false: só chega por outra)"
      },
      "via": {
        "type": "string[]",
        "description": "Na transitiva: as dependências diretas (chaves de biblioteca) que a trazem para o componente"
      },
      "declared": {
        "type": "boolean",
        "description": "Declarada no build do componente"
      },
      "used": {
        "type": "boolean",
        "description": "Usada pelo código do componente (análise do bytecode)"
      }
    },
    "identityProps": []
  },
  "PRODUCES": {
    "description": "O build do componente gera a biblioteca: o pacote que os outros componentes usam (DEPENDS_ON) sai deste repositório",
    "nature": "stack",
    "pairs": [
      {
        "from": "Component",
        "to": "Library"
      }
    ],
    "props": {
      "version": {
        "type": "string",
        "description": "Versão do pacote gerada no build afirmado"
      }
    },
    "identityProps": []
  },
  "OWNS_DATA": {
    "description": "Componente define a estrutura do dataset (mapeamento ou migração)",
    "nature": "dados",
    "pairs": [
      {
        "from": "Component",
        "to": "Dataset"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "READS": {
    "description": "Componente lê o dataset",
    "nature": "dados",
    "pairs": [
      {
        "from": "Component",
        "to": "Dataset"
      }
    ],
    "props": {},
    "identityProps": []
  },
  "WRITES": {
    "description": "Componente escreve no dataset",
    "nature": "dados",
    "pairs": [
      {
        "from": "Component",
        "to": "Dataset"
      }
    ],
    "props": {},
    "identityProps": []
  }
} as const;

export type NodeType = keyof typeof NODE_TYPES;
export type RelationType = keyof typeof RELATION_TYPES;
