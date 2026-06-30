import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  draftApplicationDefinition,
  handleDraftApplication,
} from "./tools/draftApplication.js";
import {
  submitApplicationDefinition,
  handleSubmitApplication,
} from "./tools/submitApplication.js";
import {
  getApplicationStatusDefinition,
  handleGetApplicationStatus,
} from "./tools/getApplicationStatus.js";

import "./database.js";

const SERVER_NAME = "iwoca-business-finance";
const SERVER_VERSION = "0.1.0";

const TOOLS = [
  draftApplicationDefinition,
  submitApplicationDefinition,
  getApplicationStatusDefinition,
] as const;

type ToolHandler = (
  args: unknown,
) => Promise<{
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}>;

const HANDLERS: Record<string, ToolHandler> = {
  draft_application: handleDraftApplication,
  submit_application: handleSubmitApplication,
  get_application_status: handleGetApplicationStatus,
};

function buildMcpServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const handler = HANDLERS[request.params.name];
    if (!handler) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Unknown tool '${request.params.name}'.`,
          },
        ],
      };
    }
    return handler(request.params.arguments ?? {});
  });

  return server;
}

const sessions = new Map<
  string,
  { server: Server; transport: StreamableHTTPServerTransport }
>();

async function createSession(): Promise<{
  server: Server;
  transport: StreamableHTTPServerTransport;
  sessionId: string;
}> {
  const server = buildMcpServer();
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

async function start() {
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

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  app.log.info(
    `iwoca MCP server listening on http://${host}:${port}/mcp (health: /healthz)`,
  );
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start iwoca MCP server:", err);
  process.exit(1);
});
