import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  createMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
  TOOLS,
} from "./mcp.js";

const sessions = new Map<
  string,
  { server: Server; transport: StreamableHTTPServerTransport }
>();

async function createSession(): Promise<{
  server: Server;
  transport: StreamableHTTPServerTransport;
  sessionId: string;
}> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { server, transport });
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  await server.connect(transport);
  return { server, transport, sessionId: transport.sessionId ?? "" };
}

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  await app.register(cors, {
    origin: true,
    exposedHeaders: ["mcp-session-id"],
    allowedHeaders: [
      "content-type",
      "mcp-session-id",
      "mcp-protocol-version",
      "authorization",
      "accept",
    ],
  });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      if (typeof body !== "string" || body.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.get("/healthz", async () => ({
    status: "ok",
    server: SERVER_NAME,
    version: SERVER_VERSION,
    tools: TOOLS.map((t) => t.name),
  }));

  const handleMcp = async (
    req: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) => {
    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;

    let entry = sessionId ? sessions.get(sessionId) : undefined;
    if (!entry) {
      const created = await createSession();
      entry = { server: created.server, transport: created.transport };
    }

    await entry.transport.handleRequest(req.raw, reply.raw, req.body);
  };

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  return app;
}

async function start() {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  app.log.info(
    `iwoca MCP server listening on http://${host}:${port}/mcp (health: /healthz)`,
  );
}

// Only auto-start when run as the entry point, not when imported by tests.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start iwoca MCP server:", err);
    process.exit(1);
  });
}
