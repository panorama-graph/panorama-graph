/**
 * Publica o SDK no registry npm, se a versão do package.json ainda não estiver lá. Roda no CI (workflow `ci`, no
 * branch principal) e também à mão:
 *
 *   bun scripts/publish.ts
 *
 * Quem publica é o `npm publish`, com as credenciais do próprio npm: no CI, o Trusted Publishing (OIDC do GitHub
 * Actions, sem token guardado); à mão, o `npm login`. Com SDK_PUBLISH_STAGED=true (o CI), a versão vai como staged
 * (`npm stage publish`): fica no registry sem acesso público até um mantenedor aprová-la com 2FA em npmjs.com ou com
 * `npm stage approve`. Para outro registry:
 *
 *   SDK_REGISTRY_URL     registry npm (padrão: https://registry.npmjs.org/)
 *   SDK_REGISTRY_TOKEN   token de publicação, ou
 *   SDK_REGISTRY_AUTH    credencial em Basic (base64 de usuario:senha)
 *
 * Uma versão publicada não muda: mudança no SDK pede versão nova no package.json.
 *
 * No repositório, o pacote aponta para o código-fonte (`src/index.ts`), que o Bun, o Vite e o tsc dos outros
 * projetos do workspace leem direto. O publicado é o compilado: o script monta o pacote numa pasta temporária, com o
 * `dist`, o README, a licença e o package.json apontando para o `dist`.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const registry = (process.env.SDK_REGISTRY_URL || "https://registry.npmjs.org/").replace(/\/*$/, "/");
const token = process.env.SDK_REGISTRY_TOKEN ?? "";
const auth = process.env.SDK_REGISTRY_AUTH ?? "";
const staged = process.env.SDK_PUBLISH_STAGED === "true";
const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : auth ? { authorization: `Basic ${auth}` } : {};

const pkg = (await Bun.file(join(dir, "package.json")).json()) as Record<string, unknown> & { name: string; version: string };
const { name, version } = pkg;
const packument = await fetch(`${registry}${name.replace("/", "%2f")}`, { headers });
if (packument.ok) {
  const { versions = {} } = (await packument.json()) as { versions?: Record<string, unknown> };
  if (version in versions) {
    console.log(`${name}@${version} já está publicado em ${registry}: nada a fazer.`);
    process.exit(0);
  }
} else if (packument.status !== 404) {
  console.error(`O registry respondeu ${packument.status} ao consultar ${name}.`);
  process.exit(1);
}

const run = (cmd: string[], cwd = dir) => Bun.spawnSync(cmd, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exitCode;

if (run(["bun", "run", "build"]) !== 0) process.exit(1);
// Fora do workspace, para o `npm publish` não tomar a raiz do repositório pelo projeto.
const stage = mkdtempSync(join(tmpdir(), "panorama-graph-sdk-"));
cpSync(join(dir, "dist"), join(stage, "dist"), { recursive: true });
cpSync(join(dir, "README.md"), join(stage, "README.md"));
cpSync(join(dir, "..", "..", "LICENSE"), join(stage, "LICENSE"));
const { scripts: _scripts, devDependencies: _dev, ...published } = pkg;
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    { ...published, main: "./dist/index.js", types: "./dist/index.d.ts", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } },
    null,
    2,
  ),
);
// A credencial, se houver, vai num .npmrc temporário, só para o host do registry, e sai mesmo se a publicação falhar.
// Sem ela, valem as do npm (OIDC no CI, `npm login` à mão).
const host = registry.replace(/^https?:/, "");
const [user, ...rest] = Buffer.from(auth, "base64").toString("utf8").split(":");
const credential = token
  ? `${host}:_authToken=${token}\n`
  : auth
    ? `${host}:username=${user}\n${host}:_password=${Buffer.from(rest.join(":")).toString("base64")}\n`
    : "";
writeFileSync(join(stage, ".npmrc"), `registry=${registry}\n${credential}`);
let code: number;
try {
  code = run(staged ? ["npm", "stage", "publish", "."] : ["npm", "publish"], stage);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
if (code !== 0) process.exit(code);
console.log(staged ? `${name}@${version} enviado como staged a ${registry}: aguarda aprovação.` : `${name}@${version} publicado em ${registry}.`);
