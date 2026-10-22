/**
 * Inventário da infraestrutura → grafo. A entrada lista os ambientes e o que a plataforma instala em todos eles; a
 * saída são dois retratos por ambiente, com o escopo do cluster e do namespace: `k8s-infra` (o ambiente, os
 * servidores, os bancos e o que cada um roda) e `k8s-routes` (as rotas de entrada).
 */
import {
  componentKey,
  environmentKey,
  NODE_TYPES,
  resourceKey,
  type Snapshot,
  technologyKey,
} from "@panorama-graph/sdk";

type EnvironmentKind = (typeof NODE_TYPES)["Environment"]["props"]["kind"]["enum"][number];
type ResourceKind = (typeof NODE_TYPES)["Resource"]["props"]["kind"]["enum"][number];

export type InfraEnvironment = { name: string; stage: EnvironmentKind; description?: string; cluster: string; namespace: string };
export type InfraDatabase = { name: string; description?: string; declaredIn: string; hostDeclaredIn?: string };
export type InfraService = {
  name: string;
  type: ResourceKind;
  description?: string;
  engine: { name: string; version?: string };
  /** Onde o cluster declara o serviço (`statefulsets/mongodb`), no namespace do ambiente ou em `namespace`. */
  workload: string;
  namespace?: string;
  /** Caminho do repositório do componente de que o serviço é instância (`INSTANCE_OF`). */
  component?: string;
  databases?: InfraDatabase[];
};
export type InfraRoute = { ingress: string; name: string; host: string; path?: string; component: string };
export type InfraInventory = { environments: InfraEnvironment[]; services: InfraService[]; routes?: InfraRoute[] };

export function infraSnapshots(inv: InfraInventory, observedAt: string): { snapshots: Snapshot[]; errors: string[] } {
  const errors: string[] = [];
  const names = new Set(inv.services.map((s) => s.name));
  for (const r of inv.routes ?? []) if (!names.has(r.ingress)) errors.push(`rota "${r.name}": ingress "${r.ingress}" não está em services`);

  const snapshots = inv.environments.flatMap((env) => [infra(inv, env, observedAt), routes(inv, env, observedAt)]);
  return { snapshots, errors };
}

function infra(inv: InfraInventory, env: InfraEnvironment, observedAt: string): Snapshot {
  const nodes: NonNullable<Snapshot["nodes"]> = [];
  const relations: NonNullable<Snapshot["relations"]> = [];
  const environment = environmentKey(env.name);
  nodes.push({
    key: environment,
    type: "Environment",
    props: { kind: env.stage, name: env.name, ...(env.description ? { description: env.description } : {}) },
    evidence: `namespaces/${env.namespace}`,
  });

  for (const svc of inv.services) {
    const resource = resourceKey(env.name, svc.name);
    const at = `${svc.namespace ?? env.namespace}/${svc.workload}`;
    nodes.push({ key: resource, type: "Resource", props: { kind: svc.type, name: svc.name, ...(svc.description ? { description: svc.description } : {}) }, evidence: at });
    relations.push({ type: "IN_ENVIRONMENT", from: resource, to: environment, evidence: at });
    relations.push({
      type: "RUNS",
      from: resource,
      to: technologyKey(svc.engine.name),
      ...(svc.engine.version ? { props: { version: svc.engine.version } } : {}),
      evidence: at,
    });
    if (svc.component) {
      relations.push({ type: "INSTANCE_OF", from: resource, to: componentKey(svc.component), evidence: `${at}#spec.selector.matchLabels.app` });
    }
    for (const db of svc.databases ?? []) {
      const database = resourceKey(env.name, svc.name, db.name);
      nodes.push({
        key: database,
        type: "Resource",
        props: { kind: "database", name: db.name, ...(db.description ? { description: db.description } : {}) },
        evidence: `${env.namespace}/${db.declaredIn}`,
      });
      relations.push({ type: "HOSTED_ON", from: database, to: resource, evidence: `${env.namespace}/${db.hostDeclaredIn ?? db.declaredIn}` });
    }
  }
  return { source: "k8s-infra", scope: { cluster: env.cluster, namespace: env.namespace }, observedAt, evidenceBase: `k8s://${env.cluster}/`, nodes, relations };
}

/** As rotas do ambiente, mesmo sem nenhuma: retrato vazio faz as rotas que saíram virarem `stale`. */
function routes(inv: InfraInventory, env: InfraEnvironment, observedAt: string): Snapshot {
  return {
    source: "k8s-routes",
    scope: { cluster: env.cluster, namespace: env.namespace },
    observedAt,
    evidenceBase: `k8s://${env.cluster}/${env.namespace}/ingresses/`,
    nodes: [],
    relations: (inv.routes ?? []).map((r) => ({
      type: "ROUTES",
      from: resourceKey(env.name, r.ingress),
      to: componentKey(r.component),
      props: { host: r.host.replaceAll("{environment}", env.name), ...(r.path ? { path: r.path } : {}) },
      evidence: r.name,
    })),
  };
}
