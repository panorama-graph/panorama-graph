import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import type { GraphDb } from "../db/neo4j";
import type { QueryService } from "../query/QueryService";
import { createMcpServer } from "./server";

/**
 * MCP por Streamable HTTP, sem sessão: cada POST cria o servidor e o transporte, responde em JSON e fecha.
 * GET (fluxo de notificações) e DELETE (fim de sessão) não se aplicam e voltam 405.
 */
export function mcpRoutes(queries: QueryService, db: GraphDb, logger: Logger) {
  return async (app: FastifyInstance) => {
    app.post("/mcp", { schema: { tags: ["mcp"], summary: "MCP (Streamable HTTP, sem sessão)" } }, async (req, reply) => {
      const server = createMcpServer(queries, db);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try {
        await server.connect(transport);
        const res = await transport.handleRequest(toWebRequest(req), { parsedBody: req.body });
        return await sendWebResponse(reply, res);
      } catch (err) {
        logger.error({ reqId: req.id, err }, "mcp.request.error");
        throw err;
      } finally {
        await server.close();
      }
    });

    const notAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
      reply.code(405).header("allow", "POST").send({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Método não suportado: este servidor MCP não mantém sessão (use POST)" },
        id: null,
      });
    app.get("/mcp", { schema: { hide: true } }, notAllowed);
    app.delete("/mcp", { schema: { hide: true } }, notAllowed);
  };
}

function toWebRequest(req: FastifyRequest): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k === "content-length" || k === "transfer-encoding") continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method: req.method, headers });
}

async function sendWebResponse(reply: FastifyReply, res: Response) {
  reply.code(res.status);
  res.headers.forEach((v, k) => reply.header(k, v));
  const body = await res.text();
  return reply.send(body.length > 0 ? body : undefined);
}
