import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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

// Importing the tools transitively loads the SQLite layer, but pull it in
// explicitly so the database file/schema is ready before any transport connects.
import "./database.js";

export const SERVER_NAME = "iwoca-business-finance";
export const SERVER_VERSION = "0.1.0";

export const TOOLS = [
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

/**
 * Build a fresh MCP Server wired to the three iwoca tools. Each transport
 * (HTTP session or stdio) gets its own Server instance.
 */
export function createMcpServer(): Server {
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
