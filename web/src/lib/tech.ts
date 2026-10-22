/**
 * Tecnologias públicas conhecidas, para o ícone e o papel no cartão. O grafo afirma só o nome e a versão
 * (`BUILT_WITH`); o papel (linguagem, framework, build) é conhecimento público sobre a tecnologia, não dado da
 * organização, e por isso fica aqui. A ordem é a prioridade quando um nó mostra um ícone só: framework antes de
 * linguagem, para um serviço Spring em Java mostrar o Spring.
 */
export type TechRole = "language" | "framework" | "build" | "store" | "broker";
export type Tech = { id: string; label: string; role: TechRole; aliases: string[] };

export const TECHS: Tech[] = [
  { id: "spring", label: "Spring Boot", role: "framework", aliases: ["spring-boot", "spring"] },
  { id: "fastapi", label: "FastAPI", role: "framework", aliases: ["fastapi"] },
  { id: "fastify", label: "Fastify", role: "framework", aliases: ["fastify"] },
  { id: "react", label: "React", role: "framework", aliases: ["react"] },
  { id: "mcp", label: "MCP", role: "framework", aliases: ["mcp"] },
  { id: "nginx", label: "nginx", role: "framework", aliases: ["nginx"] },
  { id: "nodejs", label: "Node.js", role: "language", aliases: ["nodejs", "node"] },
  { id: "typescript", label: "TypeScript", role: "language", aliases: ["typescript"] },
  { id: "javascript", label: "JavaScript", role: "language", aliases: ["javascript"] },
  { id: "golang", label: "Go", role: "language", aliases: ["golang", "go"] },
  { id: "python", label: "Python", role: "language", aliases: ["python"] },
  { id: "java", label: "Java", role: "language", aliases: ["java"] },
  { id: "gradle", label: "Gradle", role: "build", aliases: ["gradle"] },
  { id: "maven", label: "Maven", role: "build", aliases: ["maven"] },
  { id: "npm", label: "npm", role: "build", aliases: ["npm"] },
  { id: "bun", label: "Bun", role: "build", aliases: ["bun"] },
  { id: "vite", label: "Vite", role: "build", aliases: ["vite"] },
  { id: "mongodb", label: "MongoDB", role: "store", aliases: ["mongodb", "mongo"] },
  { id: "postgresql", label: "PostgreSQL", role: "store", aliases: ["postgresql", "postgres"] },
  { id: "mysql", label: "MySQL", role: "store", aliases: ["mysql"] },
  { id: "mariadb", label: "MariaDB", role: "store", aliases: ["mariadb"] },
  { id: "oracle", label: "Oracle Database", role: "store", aliases: ["oracle", "oracledb"] },
  { id: "sqlserver", label: "SQL Server", role: "store", aliases: ["sqlserver", "mssql", "sql-server"] },
  { id: "redis", label: "Redis", role: "store", aliases: ["redis"] },
  { id: "dynamodb", label: "DynamoDB", role: "store", aliases: ["dynamodb", "dynamo"] },
  { id: "cassandra", label: "Cassandra", role: "store", aliases: ["cassandra"] },
  { id: "elasticsearch", label: "Elasticsearch", role: "store", aliases: ["elasticsearch", "elastic"] },
  { id: "opensearch", label: "OpenSearch", role: "store", aliases: ["opensearch"] },
  { id: "neo4j", label: "Neo4j", role: "store", aliases: ["neo4j"] },
  { id: "influxdb", label: "InfluxDB", role: "store", aliases: ["influxdb", "influx"] },
  { id: "s3", label: "Amazon S3", role: "store", aliases: ["s3", "amazon-s3", "aws-s3"] },
  { id: "minio", label: "MinIO", role: "store", aliases: ["minio"] },
  { id: "kafka", label: "Kafka", role: "broker", aliases: ["kafka"] },
];

/** Ordem das insígnias no cartão do componente. */
export const CARD_ROLES: TechRole[] = ["language", "framework", "build"];

/** Nome inteiro ou um pedaço dele (separado por `-`, `_`, `.`, `/`, `:` ou espaço): `tech:spring-boot`, `mongodb-7`. */
function tokens(name: string): string[] {
  const lower = name.toLowerCase();
  const last = lower.split(":").pop() ?? lower;
  return [lower, last, ...last.split(/[-_./\s]+/)];
}

/** A tecnologia conhecida de um nome, se houver. */
export function techInfo(name: string): Tech | undefined {
  const found = new Set(tokens(name));
  return TECHS.find((t) => t.aliases.some((a) => found.has(a)));
}

/** A de maior prioridade entre vários nomes (o ícone de um recurso: instância e nome). */
export function techOf(names: (string | undefined)[]): string | undefined {
  const found = new Set(names.filter((n): n is string => !!n).flatMap(tokens));
  return TECHS.find((t) => t.aliases.some((a) => found.has(a)))?.id;
}
