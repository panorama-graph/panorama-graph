import { describe, expect, test } from "bun:test";
import { checkSnapshot } from "../src/check";
import { directorySnapshot, type DirectoryExport } from "../src/directory";
import { infraSnapshots, type InfraInventory } from "../src/infra";

const AT = "2026-10-01T00:00:00Z";

const directory: DirectoryExport = {
  tenant: "example",
  url: "https://directory.example.com/",
  levels: [
    { id: "diretoria", displayName: "Diretoria", order: 1 },
    { id: "squad", displayName: "Squad", order: 2, team: true },
  ],
  groups: [
    { id: "engenharia", type: "diretoria", displayName: "Engenharia" },
    { id: "squad-catalogo", type: "squad", displayName: "Squad Catálogo", parentId: "engenharia" },
  ],
  users: [{ userName: "maria.silva", displayName: "Maria Silva", memberships: [{ groupId: "squad-catalogo", title: "Tech Lead", leader: true }] }],
};

const inventory: InfraInventory = {
  environments: [
    { name: "dev", stage: "development", cluster: "c-dev", namespace: "dev" },
    { name: "hml", stage: "staging", cluster: "c-hml", namespace: "hml" },
  ],
  services: [
    {
      name: "postgres",
      type: "database-server",
      engine: { name: "PostgreSQL", version: "16" },
      workload: "statefulsets/postgres",
      component: "example/infra/postgres",
      databases: [{ name: "products", declaredIn: "statefulsets/postgres#env.POSTGRES_DB" }],
    },
    { name: "nginx", type: "ingress", engine: { name: "ingress-nginx" }, namespace: "ingress", workload: "deployments/nginx" },
  ],
  routes: [{ ingress: "nginx", name: "product-api", host: "product-api.{environment}.example.com", path: "/", component: "example/catalog/product-api" }],
};

describe("directory", () => {
  test("os níveis da organização viram nós, e cada grupo aponta para o seu", () => {
    const { snapshot, errors } = directorySnapshot(directory, AT);
    expect(errors).toEqual([]);
    expect(snapshot).toMatchObject({ source: "directory", scope: { tenant: "example" }, evidenceBase: "https://directory.example.com/" });
    expect(snapshot.nodes).toContainEqual({ key: "level:diretoria", type: "OrgLevel", props: { name: "Diretoria", order: 1 }, evidence: "levels/diretoria" });
    expect(snapshot.nodes).toContainEqual({ key: "level:squad", type: "OrgLevel", props: { name: "Squad", order: 2, team: true }, evidence: "levels/squad" });
    expect(snapshot.nodes).toContainEqual({ key: "group:engenharia", type: "Group", props: { name: "Engenharia" }, evidence: "groups/engenharia" });
    expect(snapshot.relations).toContainEqual({ type: "AT_LEVEL", from: "group:squad-catalogo", to: "level:squad", evidence: "groups/squad-catalogo" });
    expect(snapshot.relations).toContainEqual({ type: "PART_OF", from: "group:squad-catalogo", to: "group:engenharia", evidence: "groups/squad-catalogo" });
    expect(snapshot.relations).toContainEqual({
      type: "MEMBER_OF",
      from: "person:maria.silva",
      to: "group:squad-catalogo",
      props: { role: "Tech Lead", lead: true },
      evidence: "users/maria.silva",
    });
    expect(checkSnapshot(snapshot)).toEqual([]);
  });

  test("grupo de nível que não está no export e grupo que não está no export são erros", () => {
    const { errors } = directorySnapshot(
      {
        ...directory,
        groups: [...directory.groups, { id: "guilda", type: "guilda", displayName: "Guilda" }],
        users: [{ userName: "joao", displayName: "João", memberships: [{ groupId: "nenhum" }] }],
      },
      AT,
    );
    expect(errors).toEqual([
      'grupo "guilda": nível "guilda" não está nos níveis do export',
      'pessoa "joao": grupo "nenhum" não está no export',
    ]);
  });
});

describe("infra", () => {
  const { snapshots, errors } = infraSnapshots(inventory, AT);

  test("dois retratos por ambiente, com o escopo do cluster e do namespace", () => {
    expect(errors).toEqual([]);
    expect(snapshots.map((s) => [s.source, s.scope])).toEqual([
      ["k8s-infra", { cluster: "c-dev", namespace: "dev" }],
      ["k8s-routes", { cluster: "c-dev", namespace: "dev" }],
      ["k8s-infra", { cluster: "c-hml", namespace: "hml" }],
      ["k8s-routes", { cluster: "c-hml", namespace: "hml" }],
    ]);
    for (const s of snapshots) expect(checkSnapshot(s)).toEqual([]);
  });

  test("cada ambiente com os seus recursos, o motor, o banco e a evidência no cluster", () => {
    const hml = snapshots[2]!;
    expect(hml.evidenceBase).toBe("k8s://c-hml/");
    expect(hml.nodes).toContainEqual({ key: "env:hml", type: "Environment", props: { kind: "staging", name: "hml" }, evidence: "namespaces/hml" });
    expect(hml.relations).toContainEqual({ type: "IN_ENVIRONMENT", from: "resource:hml/postgres", to: "env:hml", evidence: "hml/statefulsets/postgres" });
    expect(hml.relations).toContainEqual({ type: "RUNS", from: "resource:hml/postgres", to: "tech:postgresql", props: { version: "16" }, evidence: "hml/statefulsets/postgres" });
    expect(hml.relations).toContainEqual({
      type: "INSTANCE_OF",
      from: "resource:hml/postgres",
      to: "component:example/infra/postgres",
      evidence: "hml/statefulsets/postgres#spec.selector.matchLabels.app",
    });
    expect(hml.relations).toContainEqual({ type: "HOSTED_ON", from: "resource:hml/postgres/products", to: "resource:hml/postgres", evidence: "hml/statefulsets/postgres#env.POSTGRES_DB" });
    expect(hml.relations).toContainEqual({ type: "IN_ENVIRONMENT", from: "resource:hml/nginx", to: "env:hml", evidence: "ingress/deployments/nginx" });
  });

  test("as rotas levam o nome do ambiente no host", () => {
    expect(snapshots[3]!.relations).toEqual([
      {
        type: "ROUTES",
        from: "resource:hml/nginx",
        to: "component:example/catalog/product-api",
        props: { host: "product-api.hml.example.com", path: "/" },
        evidence: "product-api",
      },
    ]);
  });

  test("rota para um ingress que não está no inventário é erro", () => {
    const res = infraSnapshots({ ...inventory, routes: [{ ...inventory.routes![0]!, ingress: "traefik" }] }, AT);
    expect(res.errors).toEqual(['rota "product-api": ingress "traefik" não está em services']);
  });
});

describe("conferência contra o modelo", () => {
  test("acha subtipo fora do modelo, propriedade desconhecida, par inválido e obrigatória ausente", () => {
    const errors = checkSnapshot({
      source: "x",
      scope: { a: "b" },
      observedAt: AT,
      evidenceBase: "e/",
      nodes: [
        { key: "component:c", type: "Component", props: { kind: "robot" } },
        { key: "group:g", type: "Group", props: { color: "blue" } },
        { key: "level:tribo", type: "OrgLevel", props: { order: "3" } },
      ],
      relations: [
        { type: "MEMBER_OF", from: "group:g", to: "group:g" },
        { type: "ROUTES", from: "resource:dev/nginx", to: "component:c" },
      ],
    });
    expect(errors).toEqual([
      'x {"a":"b"}: nó "component:c": "kind" = "robot" fora de service, bff, frontend, job, library, infra',
      'x {"a":"b"}: nó "group:g": propriedade "color" não existe no modelo',
      'x {"a":"b"}: nó "level:tribo": "order" deve ser number',
      'x {"a":"b"}: MEMBER_OF group:g → group:g: par Group → Group não é aceito',
      'x {"a":"b"}: ROUTES resource:dev/nginx → component:c: falta "host"',
    ]);
  });
});
