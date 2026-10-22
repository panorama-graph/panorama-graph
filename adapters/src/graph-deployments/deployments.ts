import { componentKey, environmentKey, httpApiKey, splitServiceVersion } from "../core/keys";
import { type Snapshot, SnapshotBuilder } from "../core/snapshot";

/** Fonte das implantações: o que o cluster diz que está rodando. */
export const SOURCE = "k8s-deployments";

/** Anotações e labels que o deploy põe nos workloads e namespaces. Neutros: nenhum produto ou organização no nome. */
export const ANNOTATIONS = {
  /** No Deployment: caminho do repositório do componente (ex.: example/catalog/product-api). */
  component: "panorama-graph.io/component",
  /** No Deployment: commit de que a imagem em execução foi construída. */
  commit: "panorama-graph.io/commit",
} as const;
export const LABELS = {
  /** No Deployment: versão do artefato (label recomendado do Kubernetes). */
  version: "app.kubernetes.io/version",
  /** No namespace: nome do ambiente (padrão: o nome do namespace). Marca o namespace como ambiente. */
  environment: "panorama-graph.io/environment",
  /** No namespace: estágio do ambiente (development, test, staging, production). */
  environmentKind: "panorama-graph.io/environment-kind",
} as const;

type Meta = { name: string; namespace?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
export type K8sDeployment = {
  metadata: Meta;
  spec?: { replicas?: number; template?: { metadata?: { labels?: Record<string, string> }; spec?: { containers?: { image?: string }[] } } };
};
export type K8sService = { metadata: Meta; spec?: { selector?: Record<string, string> } };
export type K8sNamespace = { metadata: Meta };
export type K8sList<T> = { items: T[] };

/** Uma implantação de um componente: o que precisa para o DEPLOYED_IN e para congelar o retrato daquele commit. */
export type Deployment = {
  namespace: string;
  environment: string;
  name: string;
  component: string;
  commit: string;
  version: string;
  image?: string;
  replicas?: number;
  /** Labels dos pods, para achar os Services que os selecionam. */
  podLabels?: Record<string, string>;
};

export type DeploymentsPlan = {
  deployments: Deployment[];
  /** Versões expostas na infraestrutura (Services com a versão no nome). */
  exposed: ReturnType<typeof exposedVersions>;
  snapshots: Snapshot[];
  warnings: string[];
  /** Workloads sem a anotação do componente: não são componentes do catálogo (ex.: infraestrutura). */
  ignored: number;
};

const ENVIRONMENT_KINDS = new Set(["development", "test", "staging", "production"]);

/** Tag da imagem (o que vem depois do último `:` fora do registry), sem o digest. */
export function imageTag(image: string | undefined): string | undefined {
  if (!image) return undefined;
  const ref = image.split("@")[0];
  const slash = ref.lastIndexOf("/");
  const colon = ref.lastIndexOf(":");
  return colon > slash ? ref.slice(colon + 1) : undefined;
}

/**
 * Lê os Deployments anotados e monta um retrato por ambiente (escopo `{cluster, namespace}`), com o ambiente e um
 * DEPLOYED_IN por componente e commit em execução. Com os Services, a versão exposta na infraestrutura: um Service
 * com a versão no nome (`servico-xpto-v2`) que seleciona os pods de um componente vira a API daquela versão
 * (`api:servico-xpto/v2/http`), que o componente oferece (PROVIDES) e que é a API do código implantada (VERSION_OF
 * `api:servico-xpto/http`). Os endpoints ficam os do código. Ambientes são os namespaces com o label de ambiente e os que têm
 * algum Deployment anotado; um ambiente sem implantação gera retrato vazio, e as implantações que saíram dele viram
 * histórico (stale) na API.
 */
export function planDeployments(
  deployments: K8sList<K8sDeployment>,
  namespaces: K8sList<K8sNamespace>,
  opts: { cluster: string; observedAt: string; namespaces?: string[]; services?: K8sList<K8sService> },
): DeploymentsPlan {
  const warnings: string[] = [];
  const nsMeta = new Map(namespaces.items.map((n) => [n.metadata.name, n.metadata]));
  const wanted = (ns: string) => !opts.namespaces?.length || opts.namespaces.includes(ns);

  const found: Deployment[] = [];
  let ignored = 0;
  for (const d of deployments.items) {
    const ns = d.metadata.namespace ?? "default";
    if (!wanted(ns)) continue;
    const annotations = d.metadata.annotations ?? {};
    const component = annotations[ANNOTATIONS.component];
    if (!component) {
      ignored++;
      continue;
    }
    const commit = annotations[ANNOTATIONS.commit];
    const image = d.spec?.template?.spec?.containers?.[0]?.image;
    const version = d.metadata.labels?.[LABELS.version] ?? imageTag(image);
    if (!commit || !version) {
      warnings.push(`${ns}/${d.metadata.name}: sem ${!commit ? `a anotação ${ANNOTATIONS.commit}` : `o label ${LABELS.version} nem tag na imagem`}; implantação ignorada`);
      continue;
    }
    const environment = nsMeta.get(ns)?.labels?.[LABELS.environment] ?? ns;
    const podLabels = d.spec?.template?.metadata?.labels;
    found.push({ namespace: ns, environment, name: d.metadata.name, component, commit, version, image, replicas: d.spec?.replicas, ...(podLabels ? { podLabels } : {}) });
  }

  const envNamespaces = new Set<string>(found.map((d) => d.namespace));
  for (const n of namespaces.items) if (n.metadata.labels?.[LABELS.environment] && wanted(n.metadata.name)) envNamespaces.add(n.metadata.name);

  const exposed: DeploymentsPlan["exposed"] = [];
  const snapshots = [...envNamespaces].sort().map((ns) => {
    const labels = nsMeta.get(ns)?.labels ?? {};
    const environment = labels[LABELS.environment] ?? ns;
    const kind = labels[LABELS.environmentKind];
    if (kind && !ENVIRONMENT_KINDS.has(kind)) warnings.push(`namespace ${ns}: ${LABELS.environmentKind} "${kind}" fora de ${[...ENVIRONMENT_KINDS].join(", ")}; ignorado`);
    const env = environmentKey(environment);
    const b = new SnapshotBuilder(SOURCE, { cluster: opts.cluster, namespace: ns }, `k8s://${opts.cluster}/${ns}/`);
    b.node(env, "Environment", { name: environment, ...(kind && ENVIRONMENT_KINDS.has(kind) ? { kind } : {}) }, `namespace/${ns}`);
    for (const d of found.filter((x) => x.namespace === ns)) {
      b.relation(
        "DEPLOYED_IN",
        componentKey(d.component),
        env,
        {
          version: d.version,
          commit: d.commit,
          ...(d.image ? { image: d.image } : {}),
          ...(d.replicas !== undefined ? { replicas: String(d.replicas) } : {}),
        },
        `deployment/${d.name}`,
        [d.commit],
      );
    }
    for (const e of exposedVersions(found.filter((x) => x.namespace === ns), opts.services?.items.filter((x) => (x.metadata.namespace ?? "default") === ns) ?? [])) {
      const evidence = `service/${e.name}`;
      b.node(e.api, "Api", { name: e.name, kind: "http", version: e.version }, evidence);
      b.relation("PROVIDES", componentKey(e.component), e.api, {}, evidence);
      b.relation("VERSION_OF", e.api, e.codeApi, {}, evidence);
      exposed.push({ ...e, namespace: ns });
    }
    return b.build(opts.observedAt);
  });

  return { deployments: found, exposed, snapshots, warnings, ignored };
}

/**
 * As versões expostas na infraestrutura: cada Service com a versão no nome (`servico-xpto-v2`) cujo seletor casa com
 * os pods de um componente implantado no mesmo namespace. Service sem versão no nome, sem seletor ou que não seleciona
 * componente nenhum fica de fora.
 */
export function exposedVersions(deployments: Deployment[], services: K8sService[]) {
  const out: { name: string; component: string; api: string; codeApi: string; version: string; namespace?: string }[] = [];
  for (const svc of services) {
    const { service, version } = splitServiceVersion(svc.metadata.name);
    const selector = Object.entries(svc.spec?.selector ?? {});
    if (!version || selector.length === 0) continue;
    const components = new Set(deployments.filter((d) => selector.every(([k, v]) => d.podLabels?.[k] === v)).map((d) => d.component));
    for (const component of components) {
      out.push({ name: svc.metadata.name, component, api: httpApiKey(service, version), codeApi: httpApiKey(service), version });
    }
  }
  return out;
}

/** Os commits a congelar: um por componente e commit em execução, com a versão de qualquer uma das implantações. */
export function revisionsToFreeze(deployments: Deployment[]): { component: string; commit: string; version: string }[] {
  const byId = new Map<string, { component: string; commit: string; version: string }>();
  for (const d of deployments) byId.set(`${d.component}@${d.commit}`, { component: d.component, commit: d.commit, version: d.version });
  return [...byId.values()].sort((a, b) => a.component.localeCompare(b.component) || a.commit.localeCompare(b.commit));
}

/** URL do pacote de artefatos de um commit, pelo modelo (`{component}` e `{commit}`). */
export function bundleUrl(template: string, component: string, commit: string): string {
  return template.replaceAll("{component}", component).replaceAll("{commit}", commit);
}
