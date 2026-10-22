import { describe, expect, test } from "bun:test";
import { DEFAULT_LAYERS, parseLayers, resourceLayer, serializeLayers } from "../src/lib/layers";
import { edgeEndpoints, edgeLabel, layout, overviewGraph } from "../src/lib/graphLayout";
import type { Overview, OverviewComponent } from "../src/lib/types";

const f = (source: string, props?: Record<string, unknown>) => ({ source, evidence: "e", ...(props ? { props } : {}) });
const facts = { dependent: [f("pact")], provider: [f("openapi")] };
const A = "component:acme/a";
const B = "component:acme/b";
const L = "component:acme/lib";
const T = "topic:t.created";

const component = (key: string, kind: string, resources: OverviewComponent["resources"] = []): OverviewComponent => ({
  key,
  kind,
  owners: [],
  systems: [],
  stack: [],
  provides: [],
  resources,
  libraries: 0,
});
const db = (env: string, name: string, access: string) => ({
  key: `resource:${env}/mongodb/${name}`,
  kind: "database",
  name,
  hostedOn: [{ key: `resource:${env}/mongodb`, name: "mongodb" }],
  facts: [f("service-config", { access })],
});

const data: Overview = {
  components: [
    component(A, "service", [db("dev", "a", "read-write"), db("prd", "a", "read-write"), { key: "resource:dev/redis", kind: "cache", name: "redis", facts: [f("service-config")] }]),
    component(B, "service", [db("dev", "b", "read")]),
    component(L, "library"),
  ],
  dependencies: [
    { from: A, to: B, via: [{ type: "CONSUMES", node: "api:b/http", facts }, { type: "SUBSCRIBES", node: T, facts }] },
    { from: B, to: "component:fora", via: [{ type: "SUBSCRIBES", node: "topic:x", facts }] },
  ],
  libraryLinks: [
    { from: A, to: L, packages: [{ key: "lib:maven/br.com.acme:lib-core", version: "1.2.0", facts: [f("sbom")] }] },
    {
      from: B,
      to: "component:acme/framework",
      packages: [
        { key: "lib:maven/br.com.acme:fw-bom", version: "3.0.0", facts: [f("sbom")] },
        { key: "lib:maven/br.com.acme:fw-web", version: "3.0.0", facts: [f("sbom")] },
      ],
    },
  ],
  topics: [{ key: T, publishers: [{ key: B, facts: [f("asyncapi")] }], subscribers: [{ key: A, facts: [f("asyncapi")] }], contracts: [] }],
  nodes: { current: {} },
  sources: [],
};

const keys = (xs: { key: string }[]) => xs.map((x) => x.key).sort();

describe("camadas na URL", () => {
  test("sem parâmetro vale o padrão; o padrão some da URL; vazio é gravado", () => {
    expect([...parseLayers("")].sort()).toEqual([...DEFAULT_LAYERS].sort());
    expect(serializeLayers(new Set(DEFAULT_LAYERS))).toBe("");
    expect(serializeLayers(new Set())).toBe("nenhuma");
    expect(parseLayers("nenhuma").size).toBe(0);
    expect(serializeLayers(new Set(["bancos", "service", "xyz"]))).toBe("service,bancos");
    expect([...parseLayers("service,xyz")]).toEqual(["service"]);
  });

  test("recurso pela camada do kind; gateway e ingress ficam fora", () => {
    expect(resourceLayer("database")).toBe("bancos");
    expect(resourceLayer("broker")).toBe("mensageria");
    expect(resourceLayer("ingress")).toBeNull();
    expect(resourceLayer(undefined)).toBe("outros");
  });
});

describe("grafo da visão geral por camadas", () => {
  test("padrão: componentes que se integram, API e tópicos; sem library e sem recursos", () => {
    const g = overviewGraph(data, parseLayers(""));
    expect(keys(g.nodes)).toEqual([A, B, T].sort());
    expect(g.edges.map((e) => e.id).sort()).toEqual([`${A}->${B}`, `assina:${A}->${T}`, `publica:${B}->${T}`].sort());
    // A via SUBSCRIBES entre componentes vira o tópico; a dependência fica só com a API.
    expect(g.edges.find((e) => e.id === `${A}->${B}`)!.label).toBe("API");
  });

  test("bancos: um nó por banco, juntando os ambientes; a aresta traz as afirmações de cada um", () => {
    const g = overviewGraph(data, new Set(["service", "bancos"]));
    const dbs = g.nodes.filter((n) => n.type === "Resource");
    expect(dbs.map((n) => [n.name, n.caption, n.keys])).toEqual([
      ["a", "banco · mongodb", ["resource:dev/mongodb/a", "resource:prd/mongodb/a"]],
      ["b", "banco · mongodb", ["resource:dev/mongodb/b"]],
    ]);
    const uses = g.edges.find((e) => e.from === A)!;
    expect(uses.label).toBe("read-write");
    expect(uses.facts!.sections.map((s) => s.label)).toEqual(["resource:dev/mongodb/a", "resource:prd/mongodb/a"]);
    expect(g.nodes.some((n) => n.kind === "cache")).toBe(false);
  });

  test("fila: legenda e verbos próprios (envia, consome); sem kind, tópico", () => {
    const fila = overviewGraph({ ...data, topics: data.topics.map((t) => ({ ...t, kind: "queue" })) }, parseLayers(""));
    expect(fila.nodes.find((n) => n.key === T)!.caption).toBe("fila");
    expect(fila.edges.filter((e) => e.to === T).map((e) => `${e.id} ${e.label}`).sort()).toEqual([`assina:${A}->${T} consome`, `publica:${B}->${T} envia`]);
    const topico = overviewGraph(data, parseLayers(""));
    expect(topico.nodes.find((n) => n.key === T)!.caption).toBe("tópico");
  });

  test("tipo desmarcado some, com as ligações; o centro da vizinhança fica", () => {
    const g = overviewGraph({ ...data, center: B }, new Set(["bff", "api", "cache"]));
    expect(keys(g.nodes)).toEqual([B]);
    const lib = overviewGraph(data, new Set(["library"]));
    expect(keys(lib.nodes)).toEqual([L]);
  });

  test("library: quem usa liga ao componente que gera a biblioteca, com o pacote e a versão; o de fora entra como biblioteca", () => {
    const g = overviewGraph(data, new Set(["service", "library"]));
    expect(keys(g.nodes)).toEqual([A, B, L, "component:acme/framework"].sort());
    expect(g.edges.map((e) => [e.id, e.label])).toEqual([
      [`biblioteca:${A}->${L}`, "lib-core 1.2.0"],
      [`biblioteca:${B}->component:acme/framework`, "2 pacotes · 3.0.0"],
    ]);
    expect(g.nodes.find((n) => n.key === "component:acme/framework")!.tech).toBe("library");
    expect(g.edges[1].facts!.sections.map((x) => x.label)).toEqual(["fw-bom 3.0.0", "fw-web 3.0.0"]);
    // Sem a camada, nenhuma; quem usa numa camada desligada não puxa a seta.
    expect(overviewGraph(data, parseLayers("")).edges.some((e) => e.id.startsWith("biblioteca:"))).toBe(false);
    expect(overviewGraph(data, new Set(["library"])).edges).toEqual([]);
  });

  test("recorte: quem está fora entra só pela dependência por API", () => {
    const g = overviewGraph({ ...data, dependencies: [{ from: A, to: "component:fora", via: [{ type: "CALLS", node: "endpoint:fora/GET /x", facts }] }] }, parseLayers(""));
    expect(g.nodes.map((n) => n.key)).toContain("component:fora");
  });
});

describe("agrupamento por domínio", () => {
  const sys = (key: string, ...domains: string[]) => ({ key, facts: [], domains: domains.map((d) => ({ key: d, name: d.slice(7), facts: [] })) });
  const C = "component:acme/c";
  const grouped: Overview = {
    ...data,
    components: [
      { ...component(A, "service", [db("dev", "a", "read-write")]), systems: [sys("system:sa", "domain:credito")] },
      { ...component(B, "service", [db("dev", "b", "read")]), systems: [sys("system:sb", "domain:credito")] },
      { ...component(C, "service"), systems: [sys("system:sc", "domain:credito"), sys("system:sd", "domain:seguros")] },
    ],
    dependencies: [{ from: A, to: B, via: [{ type: "CONSUMES", node: "api:b/http", facts }] }],
  };

  test("componente com um domínio fica nele; com dois, fora; tópico e recurso entram quando todos os lados estão no domínio", () => {
    const g = overviewGraph(grouped, new Set(["service", "api", "eventos", "bancos", "dominios"]));
    expect(g.groups).toEqual([{ key: "domain:credito", name: "credito", systems: ["system:sa", "system:sb"].map((k) => k.slice(7)) }]);
    const groupOf = new Map(g.nodes.map((n) => [n.key, n.group]));
    expect(groupOf.get(A)).toBe("domain:credito");
    expect(groupOf.get(C)).toBeUndefined();
    expect(groupOf.get(T)).toBe("domain:credito");
    expect(groupOf.get("resource:dev/mongodb/a")).toBe("domain:credito");
  });

  test("desligado, nenhum contorno", () => {
    const g = overviewGraph(grouped, new Set(["service", "api"]));
    expect(g.groups).toBeUndefined();
    expect(g.nodes.every((n) => !n.group)).toBe(true);
  });

  test("os contornos envolvem os nós e não se sobrepõem", () => {
    const n = (key: string, group?: string) => ({ key, name: key, type: "Component" as const, ...(group ? { group } : {}) });
    const nodes = [n("a1", "d1"), n("a2", "d1"), n("b1", "d2"), n("b2", "d2"), n("x")];
    const edges = [
      { id: "1", from: "a1", to: "b1", via: [], label: "" },
      { id: "2", from: "a2", to: "b2", via: [], label: "" },
      { id: "3", from: "x", to: "a1", via: [], label: "" },
    ];
    const p = layout(nodes, edges, [{ key: "d1", name: "d1", systems: [] }, { key: "d2", name: "d2", systems: [] }]);
    expect(p.groups.map((g) => g.key)).toEqual(["d1", "d2"]);
    const [g1, g2] = p.groups;
    const overlap = g1.x < g2.x + g2.width && g2.x < g1.x + g1.width && g1.y < g2.y + g2.height && g2.y < g1.y + g1.height;
    expect(overlap).toBe(false);
    for (const node of p.nodes) {
      for (const g of p.groups) {
        const inside = node.x >= g.x && node.x <= g.x + g.width && node.y >= g.y && node.y <= g.y + g.height;
        expect(inside).toBe(node.group === g.key);
      }
    }
  });
});

describe("componentes de infraestrutura", () => {
  const MONGO = "component:acme/infra/mongodb";
  const KAFKA = "component:acme/infra/kafka";
  const PG = "component:acme/infra/postgresql";
  const infraSys = { key: "system:bancos", facts: [], domains: [{ key: "domain:infra", name: "Infraestrutura", facts: [] }] };
  const inst = (key: string, name: string) => ({ key, name, facts: [f("k8s-infra")] });
  const dbOn = (env: string) => ({
    ...db(env, "a", "read-write"),
    hostedOn: [{ key: `resource:${env}/mongodb`, name: "mongodb", instanceOf: inst(MONGO, "mongodb"), facts: [f("service-config")] }],
  });
  const infra: Overview = {
    ...data,
    components: [
      component(A, "service", [dbOn("dev"), dbOn("prd"), { key: "resource:dev/kafka", kind: "broker", name: "kafka", instanceOf: inst(KAFKA, "kafka"), facts: [f("service-config", { access: "write" })] }]),
      { ...component(MONGO, "infra"), name: "mongodb", systems: [infraSys] },
      { ...component(KAFKA, "infra"), name: "kafka", systems: [infraSys] },
      { ...component(PG, "infra"), name: "postgresql", systems: [infraSys] },
    ],
    dependencies: [],
    topics: [],
  };

  test("o broker usado é o próprio componente; o banco aponta para o servidor; a infra sem uso fica de fora", () => {
    const g = overviewGraph(infra, new Set(["service", "bancos", "mensageria"]));
    expect(keys(g.nodes)).toEqual([A, "resource:dev/mongodb/a", MONGO, KAFKA].sort());
    expect(g.nodes.find((n) => n.key === KAFKA)).toMatchObject({ type: "Component", kind: "infra", tech: "kafka" });
    const uses = g.edges.find((e) => e.to === KAFKA)!;
    expect(uses.facts!.sections.map((s) => s.label)).toEqual(["resource:dev/kafka", "resource:dev/kafka é instância de kafka"]);
    const on = g.edges.find((e) => e.from === "resource:dev/mongodb/a")!;
    expect(on).toMatchObject({ to: MONGO, label: "está em" });
    expect(on.facts!.sections).toHaveLength(4); // dois ambientes: o banco na instância e a instância do servidor
  });

  test("as afirmações de cada ambiente vêm com o nome dele, na ordem até a produção", () => {
    const stage = { development: "dev", staging: "stage", production: "prd" } as const;
    const onEnv = (kind: keyof typeof stage) => {
      const env = stage[kind];
      const base = dbOn(env);
      return { ...base, hostedOn: base.hostedOn.map((h) => ({ ...h, environments: [{ key: `env:${env}`, name: env, kind, facts: [f("k8s-infra")] }] })) };
    };
    const byEnv: Overview = { ...infra, components: [component(A, "service", [onEnv("production"), onEnv("development"), onEnv("staging")])] };
    const g = overviewGraph(byEnv, new Set(["service", "bancos"]));
    const uses = g.edges.find((e) => e.from === A)!;
    expect(uses.facts!.sections.map((s) => s.label)).toEqual([
      "dev · resource:dev/mongodb/a",
      "stage · resource:stage/mongodb/a",
      "prd · resource:prd/mongodb/a",
    ]);
    const on = g.edges.find((e) => e.label === "está em")!;
    expect(on.facts!.sections[0].label).toBe("dev · resource:dev/mongodb/a está em resource:dev/mongodb");
  });

  test("camada infra: todos os componentes de infraestrutura, no domínio deles", () => {
    const g = overviewGraph(infra, new Set(["infra", "dominios"]));
    expect(keys(g.nodes)).toEqual([MONGO, KAFKA, PG].sort());
    expect(g.groups!.map((x) => x.name)).toEqual(["Infraestrutura"]);
    expect(g.nodes.every((n) => n.group === "domain:infra")).toBe(true);
  });

  test("o tópico está no broker: seta até o componente kafka com a camada mensageria; fica no domínio de quem o usa", () => {
    const credito = { key: "system:sa", facts: [], domains: [{ key: "domain:credito", name: "Crédito", facts: [] }] };
    const withTopic: Overview = {
      ...infra,
      components: infra.components.map((c) => (c.key === A ? { ...c, systems: [credito] } : c)),
      topics: [
        {
          key: T,
          publishers: [{ key: A, facts: [f("asyncapi")] }],
          subscribers: [],
          contracts: [],
          hostedOn: ["dev", "prd"].map((env) => ({ key: `resource:${env}/kafka`, name: "kafka", instanceOf: inst(KAFKA, "kafka"), facts: [f("service-config")] })),
        },
      ],
    };
    expect(overviewGraph(withTopic, new Set(["service", "eventos"])).edges.some((e) => e.to === KAFKA)).toBe(false);

    const g = overviewGraph(withTopic, new Set(["service", "eventos", "mensageria", "dominios"]));
    const on = g.edges.find((e) => e.from === T)!;
    expect(on).toMatchObject({ to: KAFKA, label: "está em" });
    expect(on.facts!.sections.map((s) => s.label)).toEqual([
      `${T} está em resource:dev/kafka`,
      "resource:dev/kafka é instância de kafka",
      `${T} está em resource:prd/kafka`,
      "resource:prd/kafka é instância de kafka",
    ]);
    expect(g.nodes.find((n) => n.key === T)!.group).toBe("domain:credito");
  });

  describe("uso direto do broker coberto pelo tópico", () => {
    const kafkaUse = (env: string) => ({ key: `resource:${env}/kafka`, kind: "broker", name: "kafka", instanceOf: inst(KAFKA, "kafka"), facts: [f("service-config", { access: "write" })] });
    const hostedOn = (...envs: string[]) => envs.map((env) => ({ key: `resource:${env}/kafka`, name: "kafka", instanceOf: inst(KAFKA, "kafka"), facts: [f("service-config")] }));
    const scenario = (uses: string[], topicEnvs: string[]): Overview => ({
      ...infra,
      components: [component(A, "service", uses.map(kafkaUse)), { ...component(KAFKA, "infra"), name: "kafka" }],
      topics: [{ key: T, publishers: [{ key: A, facts: [f("asyncapi")] }], subscribers: [], contracts: [], hostedOn: hostedOn(...topicEnvs) }],
    });
    const on = new Set(["service", "eventos", "mensageria"]);

    test("com o tópico nos mesmos ambientes, a seta direta some e as afirmações vão para o publica", () => {
      const g = overviewGraph(scenario(["dev", "prd"], ["dev", "prd"]), on);
      expect(g.edges.some((e) => e.from === A && e.to === KAFKA)).toBe(false);
      const publica = g.edges.find((e) => e.from === A && e.to === T)!;
      expect(publica.facts!.sections.map((s) => s.label)).toEqual([
        undefined,
        "a usa resource:dev/kafka (write)",
        "resource:dev/kafka é instância de kafka",
        "a usa resource:prd/kafka (write)",
        "resource:prd/kafka é instância de kafka",
      ]);
      expect(g.nodes.find((n) => n.key === T)!.tech).toBe("kafka");
    });

    test("uso direto num ambiente sem tópico fica com a seta direta", () => {
      const g = overviewGraph(scenario(["dev", "prd"], ["dev"]), on);
      expect(g.edges.find((e) => e.from === A && e.to === KAFKA)).toMatchObject({ label: "write" });
    });

    test("sem a camada eventos, a seta direta aparece", () => {
      const g = overviewGraph(scenario(["dev"], ["dev"]), new Set(["service", "mensageria"]));
      expect(g.edges.find((e) => e.from === A && e.to === KAFKA)).toBeDefined();
    });
  });
});

describe("endpoints da ligação", () => {
  test("os endpoints chamados, pelo caminho e método; a API sozinha não tem o que expandir", () => {
    const via = (node: string, endpoint?: { method?: string; path?: string }) => ({ type: "CALLS", node, api: "api:b/http", ...(endpoint ? { endpoint } : {}), facts });
    const g = overviewGraph(
      {
        ...data,
        dependencies: [
          {
            from: A,
            to: B,
            via: [
              { type: "CONSUMES", node: "api:b/http", facts },
              via("endpoint:b/2", { method: "POST", path: "/xs" }),
              via("endpoint:b/1", { method: "GET", path: "/xs" }),
              via("endpoint:b/3"),
            ],
          },
        ],
      },
      new Set(["service", "api"]),
    );
    const edge = g.edges.find((e) => e.id === `${A}->${B}`)!;
    expect(edge.label).toBe("API · 3 endpoints");
    expect(edgeEndpoints(edge)).toEqual([
      { key: "endpoint:b/1", method: "GET", path: "/xs" },
      { key: "endpoint:b/2", method: "POST", path: "/xs" },
      { key: "endpoint:b/3" },
    ]);
    expect(edgeEndpoints({ ...edge, via: edge.via.filter((v) => v.type === "CONSUMES") })).toEqual([]);
    const one = { ...edge, via: edge.via.filter((v) => v.node !== "endpoint:b/2" && v.node !== "endpoint:b/3") };
    expect(edgeLabel(one.via)).toBe("API · GET /xs");
    expect(edgeLabel(one.via.filter((v) => v.type === "CALLS").map((v) => ({ ...v, endpoint: undefined })))).toBe("1 endpoint");
  });
});
