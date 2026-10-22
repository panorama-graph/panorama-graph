#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PanoramaGraphClient } from "@panorama-graph/sdk";
import { ANNOTATIONS, LABELS, planDeployments, type K8sDeployment, type K8sList, type K8sNamespace, type K8sService } from "./deployments";
import { publishDeployments } from "./publish";

const USAGE = `graph-deployments — publica no panorama-graph-api o que está implantado em cada ambiente do cluster

Lê os Deployments com a anotação ${ANNOTATIONS.component} e publica, por namespace (ambiente), um DEPLOYED_IN
por componente e commit em execução. Antes, congela o retrato de cada commit que a API ainda não tem, a partir do
pacote de artefatos de arquitetura daquele commit (--bundle-url), e refaz o que uma versão mais antiga dos
adaptadores montou.

Uso: graph-deployments [opções]

  --api <url>            URL do panorama-graph-api (ou GRAPH_API_URL)
  --cluster <nome>       nome do cluster no escopo dos retratos (ou GRAPH_CLUSTER; padrão: default)
  --bundle-url <modelo>  URL do pacote (tar.gz de build/architecture) de um commit, com {component} e {commit}
                         (ou GRAPH_BUNDLE_URL). Sem ela, as implantações são publicadas sem congelar
  --host <host>          host do repositório, se o manifest.json do pacote não trouxer a URL dele
  --namespace <ns>       só este namespace (repetível)
  --deployments <arq>    JSON de "kubectl get deployments -A -o json" (padrão: roda o kubectl)
  --namespaces <arq>     JSON de "kubectl get namespaces -o json" (padrão: roda o kubectl)
  --services <arq>       JSON de "kubectl get services -A -o json" (padrão: roda o kubectl), para as versões expostas
  --dry-run              mostra o que seria publicado, sem enviar
  --observed-at <iso>    quando o cluster foi lido (padrão: agora)

Anotações no Deployment: ${ANNOTATIONS.component} (caminho do repositório), ${ANNOTATIONS.commit} (commit) e o
label ${LABELS.version} (versão; sem ele, a tag da imagem). No namespace: ${LABELS.environment} (nome do ambiente;
marca o namespace como ambiente) e ${LABELS.environmentKind} (development, test, staging, production).

Saída 0: publicado. 1: erro de uso ou de leitura. 2: a API recusou um retrato.`;

function kubectl<T>(args: string[]): T {
  const res = Bun.spawnSync(["kubectl", ...args, "-o", "json"], { stderr: "pipe" });
  if (res.exitCode !== 0) throw new Error(`kubectl ${args.join(" ")}: ${res.stderr.toString().trim()}`);
  return JSON.parse(res.stdout.toString()) as T;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      api: { type: "string" },
      cluster: { type: "string" },
      "bundle-url": { type: "string" },
      host: { type: "string" },
      namespace: { type: "string", multiple: true },
      deployments: { type: "string" },
      namespaces: { type: "string" },
      services: { type: "string" },
      "dry-run": { type: "boolean" },
      "observed-at": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const observedAt = values["observed-at"] ?? new Date().toISOString();
  const deployments = values.deployments
    ? readJson<K8sList<K8sDeployment>>(values.deployments)
    : kubectl<K8sList<K8sDeployment>>(["get", "deployments", "--all-namespaces"]);
  const namespaces = values.namespaces ? readJson<K8sList<K8sNamespace>>(values.namespaces) : kubectl<K8sList<K8sNamespace>>(["get", "namespaces"]);
  const cluster = values.cluster ?? process.env.GRAPH_CLUSTER ?? "default";
  const services = values.services ? readJson<K8sList<K8sService>>(values.services) : kubectl<K8sList<K8sService>>(["get", "services", "--all-namespaces"]);
  const plan = planDeployments(deployments, namespaces, { cluster, observedAt, namespaces: values.namespace, services });

  console.log(`cluster ${cluster}: ${plan.deployments.length} implantação(ões) de componentes, ${plan.ignored} workload(s) sem anotação`);
  for (const d of plan.deployments) console.log(`  ${d.environment.padEnd(8)} ${d.component} ${d.version} @ ${d.commit.slice(0, 12)}`);
  for (const e of plan.exposed) console.log(`  ${e.namespace}/${e.name}: ${e.component} expõe ${e.api} (versão de ${e.codeApi})`);
  for (const w of plan.warnings) console.warn(`  aviso: ${w}`);
  if (values["dry-run"]) return 0;

  const url = values.api ?? process.env.GRAPH_API_URL;
  if (!url) {
    console.error("Informe --api ou GRAPH_API_URL (ou use --dry-run).");
    return 1;
  }
  const client = new PanoramaGraphClient({ baseUrl: url });
  await client.assertModel();
  const result = await publishDeployments(plan, {
    client,
    bundleUrlTemplate: values["bundle-url"] ?? process.env.GRAPH_BUNDLE_URL,
    host: values.host,
    observedAt,
    log: (l) => console.log(l),
  });
  console.log(
    `congelados ${result.frozen.length}, refeitos ${result.refrozen.length}, já congelados ${result.alreadyFrozen.length}, sem pacote ${result.missing.length}`,
  );
  return result.failed ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
