import neo4j, { Neo4jError, type Driver, type ManagedTransaction, type QueryResult, type RecordShape } from "neo4j-driver";
import { setTimeout } from "node:timers/promises";

export type Neo4jConfig = { uri: string; user: string; password: string; database: string };

export type ServerInfo = { name: string; version: string; edition: string };

const CONSTRAINT_RETRIES = 5;

/** Violação de restrição de unicidade: duas transações criaram a mesma chave ao mesmo tempo. */
function isConstraintRace(err: unknown): boolean {
  return err instanceof Neo4jError && err.code === "Neo.ClientError.Schema.ConstraintValidationFailed";
}

/** Acesso ao Neo4j: um driver por processo, uma sessão por consulta, sempre no database configurado. */
export class GraphDb {
  readonly driver: Driver;
  readonly database: string;

  constructor(config: Neo4jConfig) {
    this.driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password), {
      connectionAcquisitionTimeout: 5_000,
      connectionTimeout: 5_000,
      maxTransactionRetryTime: 5_000,
      // Contagens e números voltam como number do JS; o grafo não guarda inteiros acima de 2^53.
      disableLosslessIntegers: true,
    });
    this.database = config.database;
  }

  read<R extends RecordShape = RecordShape>(cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult<R>> {
    return this.driver.executeQuery<QueryResult<R>>(cypher, params, {
      database: this.database,
      routing: neo4j.routing.READ,
    });
  }

  write<R extends RecordShape = RecordShape>(cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult<R>> {
    return this.driver.executeQuery<QueryResult<R>>(cypher, params, {
      database: this.database,
      routing: neo4j.routing.WRITE,
    });
  }

  /**
   * Várias consultas numa transação de escrita. A função pode ser reexecutada em erro transitório e quando outra
   * transação criou ao mesmo tempo um nó com a mesma chave: o MERGE não é atômico entre transações, e quem perde
   * a corrida recebe a violação da restrição. Na nova tentativa, o nó já existe e a função o encontra.
   */
  async writeTx<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const session = this.driver.session({ database: this.database, defaultAccessMode: neo4j.session.WRITE });
      try {
        return await session.executeWrite(work);
      } catch (err) {
        if (!isConstraintRace(err) || attempt >= CONSTRAINT_RETRIES) throw err;
        await setTimeout(20 * attempt + Math.random() * 30);
      } finally {
        await session.close();
      }
    }
  }

  /** Várias consultas numa transação de leitura. O servidor recusa escrita nela. `timeout` em ms. */
  async readTx<T>(work: (tx: ManagedTransaction) => Promise<T>, opts: { timeout?: number } = {}): Promise<T> {
    const session = this.driver.session({ database: this.database, defaultAccessMode: neo4j.session.READ });
    try {
      return await session.executeRead(work, opts.timeout ? { timeout: opts.timeout } : undefined);
    } finally {
      await session.close();
    }
  }

  async serverInfo(): Promise<ServerInfo> {
    const { records } = await this.driver.executeQuery(
      "CALL dbms.components() YIELD name, versions, edition RETURN name, versions[0] AS version, edition",
      {},
      { database: "system", routing: neo4j.routing.READ },
    );
    const r = records[0];
    return { name: r.get("name"), version: r.get("version"), edition: r.get("edition") };
  }

  /** Consulta mínima sem retentativas: para a checagem de saúde falhar rápido. */
  async ping(): Promise<void> {
    const session = this.driver.session({ database: this.database, defaultAccessMode: neo4j.session.READ });
    try {
      await session.run("RETURN 1");
    } finally {
      await session.close();
    }
  }

  verifyConnectivity(): Promise<unknown> {
    return this.driver.verifyConnectivity({ database: this.database });
  }

  close(): Promise<void> {
    return this.driver.close();
  }
}
