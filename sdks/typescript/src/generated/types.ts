// Gerado por `pnpm run sdk:generate` no panorama-graph-api, a partir de contract/openapi-v1.json. Não edite à mão.

export type components = {
    schemas: {
        /** @description Erro */
        Error: {
            /** @description Mensagem legível */
            error: string;
            /**
             * @description Código estável do erro: o cliente decide por ele, não pela mensagem
             * @enum {string}
             */
            code: "invalid_request" | "forbidden" | "not_found" | "unknown_tool" | "method_not_allowed" | "conflict" | "ambiguous" | "outdated_snapshot" | "payload_too_large" | "unsupported_media_type" | "unprocessable" | "invalid_snapshot" | "internal" | "unavailable";
            /** @description Status HTTP */
            status: number;
            /** @description Dados do erro, conforme o código */
            details?: {
                [key: string]: unknown;
            };
        };
        /** @description Uma afirmação: quem afirmou, onde viu e, em full, o escopo e quando. Com detail summary, só o que serve para citar */
        Fact: {
            /** @description Fonte que afirmou */
            source: string;
            /** @description Onde a fonte viu (ex.: repo@sha:caminho:linha) */
            evidence: string;
            /** @description Propriedades da relação segundo esta fonte (ex.: version) */
            props?: {
                [key: string]: unknown;
            };
            /**
             * @description Em summary, só quando é stale
             * @enum {string}
             */
            status?: "current" | "stale";
            /**
             * @description Em summary, só quando não é observed
             * @enum {string}
             */
            state?: "observed" | "inferred" | "confirmed";
            /** @description Só em full */
            scope?: {
                [key: string]: string;
            };
            /** @description Só em full: o último retrato que afirmou */
            observedAt?: string;
            /** @description Só em full: o primeiro retrato que afirmou */
            firstObservedAt?: string;
        };
        /** @description Ponta de uma relação: o suficiente para identificar o nó e seguir com outra consulta */
        NodeRef: {
            key: string;
            /** @enum {string} */
            type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
            name?: string;
            kind?: string;
            /** @description Em APIs e tópicos versionados, a versão da interface (v1, v2). Em componentes, só no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
            version?: string;
        };
        /** @description Relação lógica vista de um nó, com uma afirmação por fonte e escopo */
        Edge: {
            /** @enum {string} */
            type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
            node: components["schemas"]["NodeRef"];
            /**
             * @description Visto do nó dono: out (dono → node) ou in (node → dono)
             * @enum {string}
             */
            direction?: "out" | "in";
            /** @description Propriedades que distinguem duas afirmações entre os mesmos nós */
            identity?: {
                [key: string]: unknown;
            };
            facts: components["schemas"]["Fact"][];
        };
        /** @description Nó com as próprias afirmações de existência */
        NodeView: {
            key: string;
            /** @enum {string} */
            type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
            /**
             * @description current enquanto alguma fonte afirma o nó ou uma relação current chega nele
             * @enum {string}
             */
            status: "current" | "stale";
            /** @description Propriedades da relação segundo esta fonte (ex.: version) */
            props: {
                [key: string]: unknown;
            };
            /** @description Nenhuma fonte declarou o nó: existe só como ponta de relação */
            referenced: boolean;
            aliases: string[];
            /** @description Afirmações de existência do nó */
            facts: components["schemas"]["Fact"][];
            /** @description Só em componentes, no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
            version?: string;
        };
        /** @description O que uma resposta vazia quer dizer: quais fontes afirmam hoje aquele tipo de fato */
        Coverage: {
            what: string;
            sources: components["schemas"]["SourceCoverage"][];
            note?: string;
        };
        SourceCoverage: {
            source: string;
            scopes: number;
            lastObservedAt: string;
        };
        /** @description Um dataset visto de um componente: se é dono da estrutura, se lê e se escreve */
        DataUse: {
            dataset: components["schemas"]["NodeRef"];
            owns?: components["schemas"]["Fact"][];
            reads?: components["schemas"]["Fact"][];
            writes?: components["schemas"]["Fact"][];
        };
        /** @description Afirmações de quem depende (CONSUMES, CALLS, SUBSCRIBES) e de quem oferece (PROVIDES, PUBLISHES) */
        DependencyFacts: {
            dependent: components["schemas"]["Fact"][];
            provider: components["schemas"]["Fact"][];
        };
        /** @description Dependência entre componentes, derivada de CONSUMES, CALLS ou SUBSCRIBES */
        DependencyEdge: {
            /** @description Quem depende */
            from: string;
            /** @description De quem depende */
            to: string;
            via: {
                /** @enum {string} */
                type: "CONSUMES" | "CALLS" | "SUBSCRIBES";
                node: components["schemas"]["NodeRef"];
                /** @description Ponta de uma relação: o suficiente para identificar o nó e seguir com outra consulta */
                api?: components["schemas"]["NodeRef"];
                endpoint?: components["schemas"]["EndpointRef"];
            };
            facts: components["schemas"]["DependencyFacts"];
        };
        /** @description Um salto de um caminho de dependência: from depende de to, por uma ou mais vias */
        DependencyHop: {
            from: string;
            to: string;
            via: {
                /** @enum {string} */
                type: "CONSUMES" | "CALLS" | "SUBSCRIBES";
                node: components["schemas"]["NodeRef"];
                /** @description Ponta de uma relação: o suficiente para identificar o nó e seguir com outra consulta */
                api?: components["schemas"]["NodeRef"];
                facts: components["schemas"]["DependencyFacts"];
            }[];
        };
        /** @description Uma implantação do componente (DEPLOYED_IN): ambiente, versão e commit em execução */
        Deployment: {
            environment: components["schemas"]["NodeRef"];
            /** @description Versão em execução (rótulo) */
            version: string;
            commit: string;
            image?: string;
            replicas?: string;
            /**
             * @description stale: a implantação saiu do ambiente (vem com includeStale, como histórico)
             * @enum {string}
             */
            status: "current" | "stale";
            /** @description Primeira vez que a implantação foi vista */
            since: string;
            /** @description Última vez que a implantação foi vista */
            lastSeen: string;
            /** @description O grafo tem o retrato desta versão: o recorte do ambiente mostra o que ela oferece e usa */
            frozen: boolean;
            /** @description O commit é o da linha principal (null: a linha principal não diz de que commit é) */
            sameAsDefault: boolean | null;
            facts: components["schemas"]["Fact"][];
        };
        /** @description De que commit e versão é o retrato da linha principal (a visão padrão) */
        LineRevision: {
            commit: string;
            version?: string;
            observedAt: string;
        };
        EndpointRef: {
            method?: string;
            path?: string;
        };
        /** @description Grupo com o nível, os membros, o que possui e os subgrupos */
        OrgNode: {
            key: string;
            /** @enum {string} */
            type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
            /**
             * @description current enquanto alguma fonte afirma o nó ou uma relação current chega nele
             * @enum {string}
             */
            status: "current" | "stale";
            /** @description Propriedades da relação segundo esta fonte (ex.: version) */
            props: {
                [key: string]: unknown;
            };
            /** @description Nenhuma fonte declarou o nó: existe só como ponta de relação */
            referenced: boolean;
            aliases: string[];
            /** @description Afirmações de existência do nó */
            facts: components["schemas"]["Fact"][];
            /** @description Só em componentes, no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
            version?: string;
            /** @description Afirmações de que o grupo faz parte do pai; não vem na raiz */
            parentFacts?: components["schemas"]["Fact"][];
            /** @description Nível do grupo na estrutura (AT_LEVEL), com as afirmações de cada fonte; vazio quando nenhuma fonte o diz */
            level: components["schemas"]["Edge"][];
            members: components["schemas"]["Edge"][];
            owns: components["schemas"]["Edge"][];
            groups: components["schemas"]["OrgNode"][];
            /** @description Subgrupos além da profundidade pedida */
            moreGroups?: string[];
        };
        /** @description Contagens de uma carga (numa aposentadoria, só stale) */
        LoadCounts: {
            nodes?: {
                created?: number;
                updated?: number;
                unchanged?: number;
                stale?: number;
            };
            relations?: {
                created?: number;
                updated?: number;
                unchanged?: number;
                stale?: number;
            };
            referenced?: number;
        };
        /** @description Uso de uma biblioteca por um componente (DEPENDS_ON), com o resumo das afirmações */
        LibraryUse: {
            /** @enum {string} */
            type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
            node: components["schemas"]["NodeRef"];
            /**
             * @description Visto do nó dono: out (dono → node) ou in (node → dono)
             * @enum {string}
             */
            direction?: "out" | "in";
            /** @description Propriedades que distinguem duas afirmações entre os mesmos nós */
            identity?: {
                [key: string]: unknown;
            };
            facts: components["schemas"]["Fact"][];
            /** @description Direta (o componente declara a biblioteca) ou transitiva (chega por outra) */
            direct: boolean;
            /** @description Versão em uso: a resolvida pelo build, quando alguma fonte a dá */
            version?: string;
            /**
             * @description Declarada no build e não usada pelo código
             * @enum {boolean}
             */
            unused?: true;
            /** @description Na transitiva: as dependências diretas (chaves) que a trazem */
            via?: string[];
            /** @description Consultado um componente: o pacote dele de que este uso depende */
            library?: string;
        };
        /** @description Uma versão de uma API ou de um tópico (cada versão é um nó) */
        InterfaceVersion: {
            key: string;
            /** @description Ausente na interface sem versão */
            version?: string;
        };
        /** @description Relação de um tópico; juntando as versões, diz de qual versão é */
        TopicEdge: {
            /** @enum {string} */
            type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
            node: components["schemas"]["NodeRef"];
            /**
             * @description Visto do nó dono: out (dono → node) ou in (node → dono)
             * @enum {string}
             */
            direction?: "out" | "in";
            /** @description Propriedades que distinguem duas afirmações entre os mesmos nós */
            identity?: {
                [key: string]: unknown;
            };
            facts: components["schemas"]["Fact"][];
            /** @description Com todas as versões: o tópico (a versão) da relação */
            topic?: string;
            /** @description Com todas as versões: a versão do tópico da relação */
            version?: string;
        };
        ArchitectureOverviewArgs: {
            /** @description Domínio: chave, apelido, nome ou último segmento da chave */
            domain?: string;
            /** @description Grupo dono: chave, apelido, nome ou último segmento da chave */
            team?: string;
            /** @description Componente no centro da vizinhança (não combina com domain nem team): chave, apelido, nome ou último segmento da chave */
            component?: string;
            /** @description Níveis da vizinhança de `component` (padrão 1, máximo 5) */
            depth?: number;
            /** @description Ambiente (ex.: env:prd): só os recursos e as instâncias dele, e os componentes na versão implantada: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: summary
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        ArchitectureOverviewResult: {
            filters?: {
                domain?: string;
                team?: string;
            };
            center?: string;
            depth?: number;
            /** @description O ambiente do recorte, quando `environment` foi pedido */
            environment?: string;
            components: {
                key: string;
                name?: string;
                kind?: string;
                /** @description Só em componentes, no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
                version?: string;
                level?: number;
                status?: string;
                owners: {
                    key: string;
                    /** @description Propriedades da relação segundo esta fonte (ex.: version) */
                    identity?: {
                        [key: string]: unknown;
                    };
                    facts: components["schemas"]["Fact"][];
                }[];
                systems: {
                    key: string;
                    /** @description Propriedades da relação segundo esta fonte (ex.: version) */
                    identity?: {
                        [key: string]: unknown;
                    };
                    facts: components["schemas"]["Fact"][];
                    name?: string;
                    domains: {
                        key: string;
                        name?: string;
                        facts: components["schemas"]["Fact"][];
                    }[];
                }[];
                stack: {
                    key: string;
                    /** @description Propriedades da relação segundo esta fonte (ex.: version) */
                    identity?: {
                        [key: string]: unknown;
                    };
                    facts: components["schemas"]["Fact"][];
                }[];
                provides: {
                    key: string;
                    kind?: string;
                    endpoints: number;
                    contracts: string[];
                    facts: components["schemas"]["Fact"][];
                }[];
                resources: {
                    key: string;
                    /** @description Propriedades da relação segundo esta fonte (ex.: version) */
                    identity?: {
                        [key: string]: unknown;
                    };
                    facts: components["schemas"]["Fact"][];
                    kind?: string;
                    name?: string;
                    hostedOn: {
                        key: string;
                        name?: string;
                        instanceOf?: {
                            key: string;
                            name?: string;
                            facts: components["schemas"]["Fact"][];
                        };
                        environments: {
                            key: string;
                            name?: string;
                            kind?: string;
                            facts: components["schemas"]["Fact"][];
                        }[];
                        facts: components["schemas"]["Fact"][];
                    }[];
                    instanceOf?: {
                        key: string;
                        name?: string;
                        facts: components["schemas"]["Fact"][];
                    };
                    environments: {
                        key: string;
                        name?: string;
                        kind?: string;
                        facts: components["schemas"]["Fact"][];
                    }[];
                }[];
                data: components["schemas"]["DataUse"][];
                libraries: number;
            }[];
            dependencies: {
                from: string;
                to: string;
                via: {
                    /** @enum {string} */
                    type: "CONSUMES" | "CALLS" | "SUBSCRIBES";
                    node: string;
                    api?: string;
                    endpoint?: components["schemas"]["EndpointRef"];
                    facts: components["schemas"]["DependencyFacts"];
                }[];
            }[];
            /** @description Uso direto das bibliotecas que um componente do grafo gera (um framework ou biblioteca interna com repositório), com os pacotes usados; as de terceiros ficam de fora */
            libraryLinks: {
                /** @description Quem usa */
                from: string;
                /** @description O componente que gera a biblioteca (PRODUCES) */
                to: string;
                packages: {
                    key: string;
                    /** @description A versão em uso */
                    version?: string;
                    facts: components["schemas"]["Fact"][];
                }[];
            }[];
            topics: {
                key: string;
                kind?: string;
                name?: string;
                publishers: {
                    key: string;
                    /** @description Propriedades da relação segundo esta fonte (ex.: version) */
                    identity?: {
                        [key: string]: unknown;
                    };
                    facts: components["schemas"]["Fact"][];
                }[];
                subscribers: {
                    key: string;
                    /** @description Propriedades da relação segundo esta fonte (ex.: version) */
                    identity?: {
                        [key: string]: unknown;
                    };
                    facts: components["schemas"]["Fact"][];
                }[];
                contracts: string[];
                hostedOn: {
                    key: string;
                    name?: string;
                    instanceOf?: {
                        key: string;
                        name?: string;
                        facts: components["schemas"]["Fact"][];
                    };
                    environments: {
                        key: string;
                        name?: string;
                        kind?: string;
                        facts: components["schemas"]["Fact"][];
                    }[];
                    facts: components["schemas"]["Fact"][];
                }[];
            }[];
            nodes: {
                current: {
                    [key: string]: number;
                };
                staleHidden?: {
                    [key: string]: number;
                };
                note?: string;
            };
            sources: components["schemas"]["SourceCoverage"][];
            gaps?: string[];
            detail: string;
        };
        ComponentGetArgs: {
            /** @description Componente: chave, apelido, nome ou último segmento da chave */
            component: string;
            /** @description Ambiente (ex.: env:prd): o retrato das versões implantadas nele: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        ComponentGetResult: {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            component: components["schemas"]["NodeView"];
            /** @description De que commit e versão é o retrato da linha principal (a visão padrão) */
            revision?: components["schemas"]["LineRevision"];
            /** @description Onde o componente está implantado, em ordem até a produção */
            deployments: components["schemas"]["Deployment"][];
            owners: components["schemas"]["Edge"][];
            systems: {
                /** @enum {string} */
                type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
                node: components["schemas"]["NodeRef"];
                /**
                 * @description Visto do nó dono: out (dono → node) ou in (node → dono)
                 * @enum {string}
                 */
                direction?: "out" | "in";
                /** @description Propriedades que distinguem duas afirmações entre os mesmos nós */
                identity?: {
                    [key: string]: unknown;
                };
                facts: components["schemas"]["Fact"][];
                domains: components["schemas"]["Edge"][];
            }[];
            repositories: components["schemas"]["Edge"][];
            stack: components["schemas"]["Edge"][];
            provides: {
                /** @enum {string} */
                type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
                node: components["schemas"]["NodeRef"];
                /**
                 * @description Visto do nó dono: out (dono → node) ou in (node → dono)
                 * @enum {string}
                 */
                direction?: "out" | "in";
                /** @description Propriedades que distinguem duas afirmações entre os mesmos nós */
                identity?: {
                    [key: string]: unknown;
                };
                facts: components["schemas"]["Fact"][];
                endpoints: components["schemas"]["Edge"][];
            }[];
            /** @description Pacotes (bibliotecas) que o componente gera (PRODUCES), com a versão; quem usa cada um: library_usage */
            packages: components["schemas"]["Edge"][];
            reachesVia: components["schemas"]["Edge"][];
            resources: {
                /** @enum {string} */
                type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
                node: components["schemas"]["NodeRef"];
                /**
                 * @description Visto do nó dono: out (dono → node) ou in (node → dono)
                 * @enum {string}
                 */
                direction?: "out" | "in";
                /** @description Propriedades que distinguem duas afirmações entre os mesmos nós */
                identity?: {
                    [key: string]: unknown;
                };
                facts: components["schemas"]["Fact"][];
                environments: components["schemas"]["Edge"][];
                runs: components["schemas"]["Edge"][];
                hostedOn: {
                    /** @enum {string} */
                    type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
                    node: components["schemas"]["NodeRef"];
                    /**
                     * @description Visto do nó dono: out (dono → node) ou in (node → dono)
                     * @enum {string}
                     */
                    direction?: "out" | "in";
                    /** @description Propriedades que distinguem duas afirmações entre os mesmos nós */
                    identity?: {
                        [key: string]: unknown;
                    };
                    facts: components["schemas"]["Fact"][];
                    environments: components["schemas"]["Edge"][];
                    runs: components["schemas"]["Edge"][];
                }[];
            }[];
            data: components["schemas"]["DataUse"][];
            libraries: {
                count: number;
                detail: string;
            };
            /** @description Vem quando falta dono, recurso, dataset ou implantação: quais fontes publicam aquele tipo de fato */
            coverage?: {
                /** @description O que uma resposta vazia quer dizer: quais fontes afirmam hoje aquele tipo de fato */
                owners?: components["schemas"]["Coverage"];
                /** @description O que uma resposta vazia quer dizer: quais fontes afirmam hoje aquele tipo de fato */
                resources?: components["schemas"]["Coverage"];
                /** @description O que uma resposta vazia quer dizer: quais fontes afirmam hoje aquele tipo de fato */
                data?: components["schemas"]["Coverage"];
                /** @description O que uma resposta vazia quer dizer: quais fontes afirmam hoje aquele tipo de fato */
                deployments?: components["schemas"]["Coverage"];
            };
        };
        ComponentsListArgs: {
            /** @description Domínio: chave, apelido, nome ou último segmento da chave */
            domain?: string;
            /** @description Grupo dono: chave, apelido, nome ou último segmento da chave */
            team?: string;
            /** @enum {string} */
            kind?: "service" | "bff" | "frontend" | "job" | "library" | "infra";
            /** @description Tecnologia (ex.: spring-boot, postgresql): chave, apelido, nome ou último segmento da chave */
            technology?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: summary
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        ComponentsListResult: {
            count: number;
            truncated: boolean;
            components: {
                key: string;
                /** @enum {string} */
                type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
                /**
                 * @description current enquanto alguma fonte afirma o nó ou uma relação current chega nele
                 * @enum {string}
                 */
                status: "current" | "stale";
                /** @description Propriedades da relação segundo esta fonte (ex.: version) */
                props: {
                    [key: string]: unknown;
                };
                /** @description Nenhuma fonte declarou o nó: existe só como ponta de relação */
                referenced: boolean;
                aliases: string[];
                /** @description Afirmações de existência do nó */
                facts: components["schemas"]["Fact"][];
                /** @description Só em componentes, no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
                version?: string;
                owners: components["schemas"]["Edge"][];
                /** @description O caminho que satisfez cada filtro */
                matchedBy: {
                    filter: string;
                    path: components["schemas"]["Edge"][];
                }[];
            }[];
            coverage?: {
                owners: components["schemas"]["Coverage"];
            };
        };
        ApiConsumersArgs: {
            /** @description API (de uma versão, quando versionada) ou componente que a oferece: chave, apelido, nome ou último segmento da chave */
            target: string;
            /** @description Com uma API: os consumidores de todas as versões dela */
            allVersions?: boolean;
            /** @description Endpoint: chave, "MÉTODO /caminho" (ex.: "GET /products/{id}") ou operationId */
            endpoint?: string;
            /** @description Ambiente (ex.: env:prd): o retrato das versões implantadas nele: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        ApiConsumersResult: {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            target: string;
            /** @description Pedida uma API: as versões dela. Pedido o componente, não vem */
            versions?: components["schemas"]["InterfaceVersion"][];
            /**
             * @description Vem quando o resultado junta todas as versões
             * @enum {boolean}
             */
            allVersions?: true;
            apis: string[];
            endpoint?: string;
            consumers: {
                component: components["schemas"]["NodeRef"];
                consumes: components["schemas"]["Edge"][];
                calls: components["schemas"]["Edge"][];
            }[];
        };
        ContractGetArgs: {
            /** @description API ou componente que a oferece: chave, apelido, nome ou último segmento da chave */
            target: string;
            /** @description Endpoint: chave, "MÉTODO /caminho" (ex.: "POST /orders") ou operationId */
            endpoint?: string;
            /** @description Ambiente (ex.: env:prd): o retrato das versões implantadas nele: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: summary
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        ContractGetResult: {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            target: string;
            apis: {
                api: components["schemas"]["NodeView"];
                contracts: components["schemas"]["Edge"][];
                endpoints: {
                    /** @enum {string} */
                    type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
                    node: components["schemas"]["NodeRef"];
                    /**
                     * @description Visto do nó dono: out (dono → node) ou in (node → dono)
                     * @enum {string}
                     */
                    direction?: "out" | "in";
                    /** @description Propriedades que distinguem duas afirmações entre os mesmos nós */
                    identity?: {
                        [key: string]: unknown;
                    };
                    facts: components["schemas"]["Fact"][];
                    hasContract?: boolean;
                    method?: string;
                    path?: string;
                    operationId?: string;
                    description?: string;
                }[];
            }[];
            detail: string;
        } | {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            target: string;
            endpoint: components["schemas"]["NodeView"];
            apis: {
                /** @enum {string} */
                type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
                node: components["schemas"]["NodeRef"];
                /**
                 * @description Visto do nó dono: out (dono → node) ou in (node → dono)
                 * @enum {string}
                 */
                direction?: "out" | "in";
                /** @description Propriedades que distinguem duas afirmações entre os mesmos nós */
                identity?: {
                    [key: string]: unknown;
                };
                facts: components["schemas"]["Fact"][];
                contracts: components["schemas"]["Edge"][];
            }[];
            /** @description parameters, requestBody, responses e, em components, o fecho dos $ref locais */
            contract?: {
                [key: string]: unknown;
            };
            coverage?: {
                contract: {
                    what: string;
                    note: string;
                };
            };
        };
        ComponentDependenciesArgs: {
            /** @description Componente: chave, apelido, nome ou último segmento da chave */
            component: string;
            /**
             * @description Padrão: out
             * @enum {string}
             */
            direction?: "out" | "in" | "both";
            /** @description Níveis transitivos (padrão 1, máximo 5) */
            depth?: number;
            /**
             * @description Só componentes deste tipo, com os caminhos
             * @enum {string}
             */
            kind?: "service" | "bff" | "frontend" | "job" | "library" | "infra";
            /** @description Ambiente (ex.: env:prd): o retrato das versões implantadas nele: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        ComponentDependenciesResult: {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            root: string;
            /** @enum {string} */
            direction: "out" | "in" | "both";
            depth: number;
            components: {
                key: string;
                /** @enum {string} */
                type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
                name?: string;
                kind?: string;
                /** @description Em APIs e tópicos versionados, a versão da interface (v1, v2). Em componentes, só no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
                version?: string;
                level: number;
            }[];
            edges: components["schemas"]["DependencyEdge"][];
        } | {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            root: string;
            /** @enum {string} */
            direction: "out" | "in" | "both";
            depth: number;
            /** @enum {string} */
            kind: "service" | "bff" | "frontend" | "job" | "library" | "infra";
            components: {
                key: string;
                /** @enum {string} */
                type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
                name?: string;
                kind?: string;
                /** @description Em APIs e tópicos versionados, a versão da interface (v1, v2). Em componentes, só no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
                version?: string;
                level: number;
                paths: components["schemas"]["DependencyHop"][][];
            }[];
            coverage?: {
                componentsOfKind: number;
                note: string;
            };
        };
        ComponentCompareArgs: {
            /** @description Componente: chave, apelido, nome ou último segmento da chave */
            component: string;
            /** @description Ambiente do lado de origem (omitido: a linha principal): chave, apelido, nome ou último segmento da chave */
            from?: string;
            /** @description Ambiente do lado de destino (omitido: a linha principal): chave, apelido, nome ou último segmento da chave */
            to?: string;
        };
        ComponentCompareResult: {
            component: string;
            from: {
                /** @description Este lado é a linha principal */
                line?: boolean;
                environment?: string;
                version?: string;
                commit?: string;
                /** @description No ambiente: o grafo tem o retrato da versão implantada */
                frozen?: boolean;
                /** @description Quando o lado pedido não pôde ser montado com a versão implantada */
                note?: string;
            };
            to: {
                /** @description Este lado é a linha principal */
                line?: boolean;
                environment?: string;
                version?: string;
                commit?: string;
                /** @description No ambiente: o grafo tem o retrato da versão implantada */
                frozen?: boolean;
                /** @description Quando o lado pedido não pôde ser montado com a versão implantada */
                note?: string;
            };
            /** @description Nada mudou nas categorias comparadas */
            same: boolean;
            /** @description Só as categorias com mudança */
            changes: {
                endpoints?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                consumes?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                calls?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                publishes?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                subscribes?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                owns?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                reads?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                writes?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                resources?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                libraries?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
                stack?: {
                    added: components["schemas"]["NodeRef"][];
                    removed: components["schemas"]["NodeRef"][];
                    /** @description Nos dois lados, com valor diferente: a versão (bibliotecas, stack) ou o contrato (endpoints, sem o conteúdo) */
                    changed: {
                        node: components["schemas"]["NodeRef"];
                        from?: string;
                        to?: string;
                    }[];
                };
            };
        };
        TopicGetArgs: {
            /** @description Tópico (de uma versão) ou o nome sem a versão: chave, apelido, nome ou último segmento da chave */
            topic: string;
            /** @description As relações de todas as versões do tópico */
            allVersions?: boolean;
            /** @description Ambiente (ex.: env:prd): o retrato das versões implantadas nele: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        TopicGetResult: {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            topic: components["schemas"]["NodeView"];
            /** @description Pedida uma API: as versões dela. Pedido o componente, não vem */
            versions: components["schemas"]["InterfaceVersion"][];
            /**
             * @description Vem quando o resultado junta todas as versões
             * @enum {boolean}
             */
            allVersions?: true;
            publishers: components["schemas"]["TopicEdge"][];
            subscribers: components["schemas"]["TopicEdge"][];
            contracts: components["schemas"]["TopicEdge"][];
            hostedOn: components["schemas"]["TopicEdge"][];
        };
        DatasetGetArgs: {
            /** @description Dataset (ex.: products): chave, apelido, nome ou último segmento da chave */
            dataset: string;
            /** @description Ambiente (ex.: env:prd): o retrato das versões implantadas nele: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        DatasetGetResult: {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            dataset: components["schemas"]["NodeView"];
            owners: components["schemas"]["Edge"][];
            readers: components["schemas"]["Edge"][];
            writers: components["schemas"]["Edge"][];
        };
        OrgStructureArgs: {
            /** @description Grupo: chave, apelido, nome ou último segmento da chave */
            group?: string;
            /** @description Níveis de subgrupos (padrão 2) */
            depth?: number;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        OrgStructureResult: {
            depth: number;
            /** @description Níveis citados pelos grupos da resposta (OrgLevel), de cima para baixo: `order` é a posição e `team` diz se os grupos do nível são times */
            levels: components["schemas"]["NodeView"][];
            groups: components["schemas"]["OrgNode"][];
            /** @description O que uma resposta vazia quer dizer: quais fontes afirmam hoje aquele tipo de fato */
            coverage?: components["schemas"]["Coverage"];
        };
        PeopleListArgs: {
            /** @description Só os membros diretos deste grupo: chave, apelido, nome ou último segmento da chave */
            group?: string;
            /** @description Texto procurado no nome ou na chave da pessoa */
            text?: string;
            /** @description Máximo de pessoas (padrão 200) */
            limit?: number;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        PeopleListResult: {
            count: number;
            truncated: boolean;
            people: {
                key: string;
                /** @enum {string} */
                type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
                /**
                 * @description current enquanto alguma fonte afirma o nó ou uma relação current chega nele
                 * @enum {string}
                 */
                status: "current" | "stale";
                /** @description Propriedades da relação segundo esta fonte (ex.: version) */
                props: {
                    [key: string]: unknown;
                };
                /** @description Nenhuma fonte declarou o nó: existe só como ponta de relação */
                referenced: boolean;
                aliases: string[];
                /** @description Afirmações de existência do nó */
                facts: components["schemas"]["Fact"][];
                /** @description Só em componentes, no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
                version?: string;
                memberships: components["schemas"]["Edge"][];
            }[];
            /** @description O que uma resposta vazia quer dizer: quais fontes afirmam hoje aquele tipo de fato */
            coverage?: components["schemas"]["Coverage"];
        };
        LibraryUsageArgs: {
            /** @description Biblioteca (ex.: lib:maven/org.springframework.boot:spring-boot) ou o componente que gera bibliotecas: chave, apelido, nome ou último segmento da chave */
            library: string;
            versionRange?: string;
            /** @description true: só quem usa diretamente; false: só quem recebe por outra biblioteca */
            direct?: boolean;
            /** @description Ambiente (ex.: env:prd): o retrato das versões implantadas nele: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        LibraryUsageResult: {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            /** @description A biblioteca consultada, ou o componente, quando é ele o consultado */
            library: {
                key: string;
                /** @enum {string} */
                type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
                /**
                 * @description current enquanto alguma fonte afirma o nó ou uma relação current chega nele
                 * @enum {string}
                 */
                status: "current" | "stale";
                /** @description Propriedades da relação segundo esta fonte (ex.: version) */
                props: {
                    [key: string]: unknown;
                };
                /** @description Nenhuma fonte declarou o nó: existe só como ponta de relação */
                referenced: boolean;
                aliases: string[];
                /** @description Afirmações de existência do nó */
                facts: components["schemas"]["Fact"][];
                /** @description Só em componentes, no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
                version?: string;
            };
            /** @description Consultado um componente: os pacotes que o build dele gera (PRODUCES), cujos usos vêm em users */
            packages?: components["schemas"]["Edge"][];
            /** @description Consultada uma biblioteca: o componente cujo build a gera */
            producedBy?: components["schemas"]["Edge"][];
            versionRange?: string;
            direct?: boolean;
            /** @description Versões em uso, da mais nova para a mais antiga (null: sem versão afirmada), com os componentes */
            versions: {
                version: string | null;
                components: string[];
            }[];
            users: components["schemas"]["LibraryUse"][];
        };
        ComponentLibrariesArgs: {
            /** @description Componente: chave, apelido, nome ou último segmento da chave */
            component: string;
            /** @description Inclui as transitivas (padrão: só as diretas) */
            transitive?: boolean;
            /** @description Só as declaradas que o código não usa */
            unused?: boolean;
            /** @description Ambiente (ex.: env:prd): o retrato das versões implantadas nele: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: summary
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        ComponentLibrariesResult: {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            component: components["schemas"]["NodeView"];
            counts: {
                direct: number;
                transitive: number;
                unused: number;
            };
            libraries: components["schemas"]["LibraryUse"][];
            /** @description Vem quando o componente não tem biblioteca: quais fontes publicam bibliotecas */
            coverage?: components["schemas"]["Coverage"];
        };
        RouteGetArgs: {
            /** @description Host da requisição (ex.: product-api.dev.example.com) */
            host: string;
            /** @description Caminho da requisição */
            path?: string;
            /** @description Ambiente (ex.: env:prd): o retrato das versões implantadas nele: chave, apelido, nome ou último segmento da chave */
            environment?: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        RouteGetResult: {
            /** @description O ambiente do recorte, quando `environment` foi pedido: os componentes implantados nele aparecem na versão implantada */
            environment?: string;
            host: string;
            path?: string;
            routes: {
                entry: components["schemas"]["NodeRef"];
                host: string;
                path: string | null;
                to: components["schemas"]["NodeRef"];
                facts: components["schemas"]["Fact"][];
                provides: components["schemas"]["Edge"][];
            }[];
        };
        NodesFindArgs: {
            /** @description Texto procurado no nome, na chave ou num apelido */
            text?: string;
            /** @description Só nós destes tipos */
            types?: ("Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment")[];
            /** @description Só nós que nenhuma fonte declarou */
            referencedOnly?: boolean;
            /** @description Máximo de nós (padrão 50) */
            limit?: number;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
        };
        NodesFindResult: {
            count: number;
            truncated: boolean;
            nodes: {
                key: string;
                /** @enum {string} */
                type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
                name?: string;
                kind?: string;
                /** @description Em APIs e tópicos versionados, a versão da interface (v1, v2). Em componentes, só no recorte de um ambiente: a versão implantada nele (no canário, mais de uma, separadas por vírgula) */
                version?: string;
                /** @enum {string} */
                status: "current" | "stale";
                referenced: boolean;
                matchedAlias?: string;
            }[];
        };
        NodeGetArgs: {
            /** @description Nó: chave, apelido, nome ou último segmento da chave */
            node: string;
            /** @description Inclui afirmações stale (que a fonte deixou de fazer), com a data em que foram vistas pela última vez */
            includeStale?: boolean;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        NodeGetResult: {
            node: components["schemas"]["NodeView"];
            relations: {
                /** @enum {string} */
                type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
                /** @enum {string} */
                direction: "out" | "in";
                description: string;
                total: number;
                truncated?: boolean;
                edges: components["schemas"]["Edge"][];
            }[];
        };
        SourcesStatusArgs: {
            /** @description Só esta fonte */
            source?: string;
            /** @description Máximo de cargas recentes (padrão 50) */
            limit?: number;
        };
        SourcesStatusResult: {
            sources: {
                source: string;
                lastObservedAt: string;
                scopes: {
                    /** @description Só em full */
                    scope: {
                        [key: string]: string;
                    };
                    lastObservedAt: string;
                    receivedAt?: string;
                    /** @description Contagens de uma carga (numa aposentadoria, só stale) */
                    counts?: components["schemas"]["LoadCounts"];
                    retired?: {
                        by: string;
                        reason: string;
                    };
                    /** @description De que versão de um componente é o retrato; frozen: retrato congelado daquele commit */
                    revision?: {
                        component: string;
                        commit: string;
                        version?: string;
                        frozen: boolean;
                    };
                    /** @description Quem montou o último retrato do escopo, e em que versão (quando o produtor informa) */
                    producer?: {
                        name: string;
                        version: string;
                    };
                }[];
                scopeCount: number;
            }[];
            loads: {
                id: string;
                source: string;
                /** @description Só em full */
                scope: {
                    [key: string]: string;
                };
                observedAt: string;
                receivedAt: string;
                counts: components["schemas"]["LoadCounts"];
                retired?: {
                    by: string;
                    reason: string;
                    evidence: string;
                };
            }[];
            coverage: {
                what: string;
                sources: components["schemas"]["SourceCoverage"][];
                note?: string;
                kind: string;
            }[];
        };
        FactDivergencesArgs: {
            /**
             * @description Só este tipo de relação
             * @enum {string}
             */
            relationType?: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
            /** @description Só as relações que saem deste nó ou chegam nele: chave, apelido, nome ou último segmento da chave */
            node?: string;
            /** @description Máximo de itens (padrão 200) */
            limit?: number;
            /**
             * @description summary: cada afirmação só com source, evidence e props (status e state quando fogem do comum); full: com scope, observedAt e firstObservedAt. Padrão: full
             * @enum {string}
             */
            detail?: "summary" | "full";
        };
        FactDivergencesResult: {
            count: number;
            truncated: boolean;
            divergences: {
                /** @enum {string} */
                kind: "props" | "targets";
                /** @enum {string} */
                type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
                from: components["schemas"]["NodeRef"];
                /** @description Em props: as propriedades em disputa */
                props?: string[];
                edges: components["schemas"]["Edge"][];
            }[];
        };
        GraphQueryArgs: {
            cypher: string;
            /** @description Parâmetros ($nome) da consulta */
            params?: {
                [key: string]: unknown;
            };
            /** @description Máximo de linhas (padrão 100) */
            limit?: number;
        };
        GraphQueryResult: {
            columns: string[];
            rows: {
                [key: string]: unknown;
            }[];
            truncated: boolean;
            /** @enum {string} */
            truncatedBy?: "rows" | "size";
            note?: string;
        };
        Snapshot: {
            /** @description Adaptador que afirma os fatos (ex.: pact-broker) */
            source: string;
            /**
             * @description Escopo do retrato. Fatos da mesma source e escopo ausentes nesta carga viram stale
             * @default {}
             */
            scope?: {
                [key: string]: string;
            };
            /**
             * Format: date-time
             * @description Quando a fonte foi lida (ISO 8601)
             */
            observedAt: string;
            /** @description Prefixo de evidência comum; a evidência de cada fato é concatenada a ele */
            evidenceBase?: string;
            /** @description De que versão do componente é o retrato. Com a chave `commit` no escopo, é um retrato congelado daquele commit: só aparece no recorte de um ambiente em que o commit está implantado (DEPLOYED_IN). Sem ela, é o retrato da linha principal, e a revisão diz de que commit ele é */
            revision?: {
                /** @description Componente de que o retrato é uma versão (chave component:...) */
                component: string;
                /** @description Commit de que os artefatos lidos foram construídos */
                commit: string;
                /** @description Versão do artefato (rótulo, ex.: 1.4.0 ou 1.5.0-SNAPSHOT) */
                version?: string;
            };
            /** @description Quem montou o retrato a partir da fonte, e em que versão. Fica no escopo: quem relê a mesma fonte com uma versão mais nova (que extrai mais) sabe que o retrato pode mudar, e o refaz (ex.: o retrato congelado de um commit) */
            producer?: {
                /** @description Programa que montou o retrato (ex.: graph-publish) */
                name: string;
                /** @description Versão do programa (ex.: 0.2.0) */
                version: string;
            };
            /** @default [] */
            nodes?: {
                key: string;
                type: string;
                props?: {
                    [key: string]: string | number | boolean | string[] | ("null" | null);
                };
                evidence?: string;
            }[];
            /** @default [] */
            relations?: {
                type: string;
                from: string;
                to: string;
                props?: {
                    [key: string]: string | number | boolean | string[] | ("null" | null);
                };
                evidence?: string;
            }[];
        };
        /** @description Resultado de uma carga: o que foi criado, alterado, ficou igual e virou stale */
        IngestResult: {
            loadId: string;
            source: string;
            scope: {
                [key: string]: string;
            };
            observedAt: string;
            counts: {
                nodes: {
                    created: number;
                    updated: number;
                    unchanged: number;
                    stale: number;
                };
                relations: {
                    created: number;
                    updated: number;
                    unchanged: number;
                    stale: number;
                };
                referenced: number;
            };
        };
        ScopeRetirement: {
            /** @description Escopo a aposentar, igual ao das cargas (ex.: { component: example/catalog/product-api }) */
            scope: {
                [key: string]: string;
            };
            /**
             * Format: date-time
             * @description Quando o que o escopo descreve deixou de existir (ISO 8601)
             */
            observedAt: string;
            /** @description Quem aposenta (sistema ou pessoa, ex.: portal-interno) */
            retiredBy: string;
            /** @description Por que o escopo deixou de existir */
            reason: string;
            /** @description Onde isso está registrado (ex.: o registro da remoção no portal) */
            evidence: string;
        };
        RetireResult: {
            scope: {
                [key: string]: string;
            };
            observedAt: string;
            sources: {
                source: string;
                loadId: string;
                counts: {
                    nodes: {
                        stale: number;
                    };
                    relations: {
                        stale: number;
                    };
                };
            }[];
        };
        AliasRequest: {
            alias: string;
            reason?: string;
        };
        AliasResult: {
            key: string;
            alias: string;
            created: boolean;
        };
        MergeRequest: {
            /** @description Nó que deixa de existir e vira apelido */
            from: string;
            /** @description Nó que permanece */
            into: string;
            reason: string;
            /** @description Quem pediu a união */
            actor: string;
        };
        MergeResult: {
            mergeId: string;
            from: string;
            into: string;
            relations: {
                moved: number;
                deduplicated: number;
            };
            claims: {
                moved: number;
                deduplicated: number;
            };
            aliases: string[];
        };
        /** @description O modelo: tipos de nó e de relação, pares válidos, chaves e proveniência */
        ModelDescription: {
            modelVersion: number;
            keyFormat: string;
            nodeTypes: {
                /** @enum {string} */
                type: "Domain" | "System" | "Component" | "Repository" | "Api" | "Endpoint" | "Topic" | "Contract" | "Resource" | "Group" | "OrgLevel" | "Person" | "Technology" | "Library" | "Dataset" | "Environment";
                prefix: string;
                description: string;
                props: {
                    [key: string]: components["schemas"]["PropSpec"];
                };
            }[];
            relationTypes: {
                /** @enum {string} */
                type: "PART_OF" | "OWNED_BY" | "MEMBER_OF" | "AT_LEVEL" | "HOSTED_IN" | "PROVIDES" | "HAS_ENDPOINT" | "CONSUMES" | "CALLS" | "PUBLISHES" | "SUBSCRIBES" | "VERSION_OF" | "SPECIFIED_BY" | "USES_RESOURCE" | "HOSTED_ON" | "INSTANCE_OF" | "IN_ENVIRONMENT" | "DEPLOYED_IN" | "RUNS" | "ROUTES" | "REACHES_VIA" | "BUILT_WITH" | "DEPENDS_ON" | "PRODUCES" | "OWNS_DATA" | "READS" | "WRITES";
                description: string;
                nature: string;
                pairs: {
                    from: string;
                    to: string;
                }[];
                props: {
                    [key: string]: components["schemas"]["PropSpec"];
                };
                identityProps: string[];
            }[];
            provenance: {
                fields: string[];
                states: ("observed" | "inferred" | "confirmed")[];
                statuses: ("current" | "stale")[];
                rules: string[];
            };
            queryContractVersion: number;
        };
        PropSpec: {
            /** @enum {string} */
            type: "string" | "number" | "boolean" | "string[]";
            enum?: string[];
            required?: boolean;
            description: string;
        };
        /** @description O contrato das consultas: versão, política e as ferramentas com os argumentos */
        QueryContractDocument: {
            version: number;
            policy: string[];
            tools: {
                name: string;
                since: number;
                /** @enum {string} */
                stability: "stable" | "exploratory";
                deprecated?: {
                    since: number;
                    use: string;
                };
                args: {
                    [key: string]: {
                        type: string;
                        required: boolean;
                        enum?: string[];
                        deprecated?: {
                            since: number;
                            use: string;
                        };
                    };
                };
                description: string;
            }[];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};

export type ErrorBody = components["schemas"]["Error"];
export type Fact = components["schemas"]["Fact"];
export type NodeRef = components["schemas"]["NodeRef"];
export type Edge = components["schemas"]["Edge"];
export type NodeView = components["schemas"]["NodeView"];
export type Coverage = components["schemas"]["Coverage"];
export type SourceCoverage = components["schemas"]["SourceCoverage"];
export type DataUse = components["schemas"]["DataUse"];
export type DependencyFacts = components["schemas"]["DependencyFacts"];
export type DependencyEdge = components["schemas"]["DependencyEdge"];
export type DependencyHop = components["schemas"]["DependencyHop"];
export type Deployment = components["schemas"]["Deployment"];
export type LineRevision = components["schemas"]["LineRevision"];
export type EndpointRef = components["schemas"]["EndpointRef"];
export type OrgNode = components["schemas"]["OrgNode"];
export type LoadCounts = components["schemas"]["LoadCounts"];
export type LibraryUse = components["schemas"]["LibraryUse"];
export type InterfaceVersion = components["schemas"]["InterfaceVersion"];
export type TopicEdge = components["schemas"]["TopicEdge"];
export type ArchitectureOverviewArgs = components["schemas"]["ArchitectureOverviewArgs"];
export type ArchitectureOverviewResult = components["schemas"]["ArchitectureOverviewResult"];
export type ComponentGetArgs = components["schemas"]["ComponentGetArgs"];
export type ComponentGetResult = components["schemas"]["ComponentGetResult"];
export type ComponentsListArgs = components["schemas"]["ComponentsListArgs"];
export type ComponentsListResult = components["schemas"]["ComponentsListResult"];
export type ApiConsumersArgs = components["schemas"]["ApiConsumersArgs"];
export type ApiConsumersResult = components["schemas"]["ApiConsumersResult"];
export type ContractGetArgs = components["schemas"]["ContractGetArgs"];
export type ContractGetResult = components["schemas"]["ContractGetResult"];
export type ComponentDependenciesArgs = components["schemas"]["ComponentDependenciesArgs"];
export type ComponentDependenciesResult = components["schemas"]["ComponentDependenciesResult"];
export type ComponentCompareArgs = components["schemas"]["ComponentCompareArgs"];
export type ComponentCompareResult = components["schemas"]["ComponentCompareResult"];
export type TopicGetArgs = components["schemas"]["TopicGetArgs"];
export type TopicGetResult = components["schemas"]["TopicGetResult"];
export type DatasetGetArgs = components["schemas"]["DatasetGetArgs"];
export type DatasetGetResult = components["schemas"]["DatasetGetResult"];
export type OrgStructureArgs = components["schemas"]["OrgStructureArgs"];
export type OrgStructureResult = components["schemas"]["OrgStructureResult"];
export type PeopleListArgs = components["schemas"]["PeopleListArgs"];
export type PeopleListResult = components["schemas"]["PeopleListResult"];
export type LibraryUsageArgs = components["schemas"]["LibraryUsageArgs"];
export type LibraryUsageResult = components["schemas"]["LibraryUsageResult"];
export type ComponentLibrariesArgs = components["schemas"]["ComponentLibrariesArgs"];
export type ComponentLibrariesResult = components["schemas"]["ComponentLibrariesResult"];
export type RouteGetArgs = components["schemas"]["RouteGetArgs"];
export type RouteGetResult = components["schemas"]["RouteGetResult"];
export type NodesFindArgs = components["schemas"]["NodesFindArgs"];
export type NodesFindResult = components["schemas"]["NodesFindResult"];
export type NodeGetArgs = components["schemas"]["NodeGetArgs"];
export type NodeGetResult = components["schemas"]["NodeGetResult"];
export type SourcesStatusArgs = components["schemas"]["SourcesStatusArgs"];
export type SourcesStatusResult = components["schemas"]["SourcesStatusResult"];
export type FactDivergencesArgs = components["schemas"]["FactDivergencesArgs"];
export type FactDivergencesResult = components["schemas"]["FactDivergencesResult"];
export type GraphQueryArgs = components["schemas"]["GraphQueryArgs"];
export type GraphQueryResult = components["schemas"]["GraphQueryResult"];
export type Snapshot = components["schemas"]["Snapshot"];
export type IngestResult = components["schemas"]["IngestResult"];
export type ScopeRetirement = components["schemas"]["ScopeRetirement"];
export type RetireResult = components["schemas"]["RetireResult"];
export type AliasRequest = components["schemas"]["AliasRequest"];
export type AliasResult = components["schemas"]["AliasResult"];
export type MergeRequest = components["schemas"]["MergeRequest"];
export type MergeResult = components["schemas"]["MergeResult"];
export type ModelDescription = components["schemas"]["ModelDescription"];
export type PropSpec = components["schemas"]["PropSpec"];
export type QueryContractDocument = components["schemas"]["QueryContractDocument"];

/** Versão do contrato das consultas que estes tipos descrevem (`GET /v1/queries`). */
export const QUERY_CONTRACT_VERSION = 1;

/** Prefixo das rotas do REST. */
export const API_PREFIX = "/v1";

/** As consultas, servidas igual pelo REST (`POST /v1/queries/<nome>`) e pelo MCP. */
export const QUERY_NAMES = [
  "architecture_overview",
  "component_get",
  "components_list",
  "api_consumers",
  "contract_get",
  "component_dependencies",
  "component_compare",
  "topic_get",
  "dataset_get",
  "org_structure",
  "people_list",
  "library_usage",
  "component_libraries",
  "route_get",
  "nodes_find",
  "node_get",
  "sources_status",
  "fact_divergences",
  "graph_query"
] as const;

export type QueryName = (typeof QUERY_NAMES)[number];

/** Argumentos de cada consulta. */
export type QueryArgs = {
  architecture_overview: ArchitectureOverviewArgs;
  component_get: ComponentGetArgs;
  components_list: ComponentsListArgs;
  api_consumers: ApiConsumersArgs;
  contract_get: ContractGetArgs;
  component_dependencies: ComponentDependenciesArgs;
  component_compare: ComponentCompareArgs;
  topic_get: TopicGetArgs;
  dataset_get: DatasetGetArgs;
  org_structure: OrgStructureArgs;
  people_list: PeopleListArgs;
  library_usage: LibraryUsageArgs;
  component_libraries: ComponentLibrariesArgs;
  route_get: RouteGetArgs;
  nodes_find: NodesFindArgs;
  node_get: NodeGetArgs;
  sources_status: SourcesStatusArgs;
  fact_divergences: FactDivergencesArgs;
  graph_query: GraphQueryArgs;
};

/** Resposta de cada consulta (com detail full; em summary, as afirmações vêm resumidas). */
export type QueryResults = {
  architecture_overview: ArchitectureOverviewResult;
  component_get: ComponentGetResult;
  components_list: ComponentsListResult;
  api_consumers: ApiConsumersResult;
  contract_get: ContractGetResult;
  component_dependencies: ComponentDependenciesResult;
  component_compare: ComponentCompareResult;
  topic_get: TopicGetResult;
  dataset_get: DatasetGetResult;
  org_structure: OrgStructureResult;
  people_list: PeopleListResult;
  library_usage: LibraryUsageResult;
  component_libraries: ComponentLibrariesResult;
  route_get: RouteGetResult;
  nodes_find: NodesFindResult;
  node_get: NodeGetResult;
  sources_status: SourcesStatusResult;
  fact_divergences: FactDivergencesResult;
  graph_query: GraphQueryResult;
};
