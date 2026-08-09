import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  getProductInfoDefinition,
  handleGetProductInfo,
} from "./tools/getProductInfo.js";
import {
  loanCalculatorDefinition,
  handleLoanCalculator,
} from "./tools/loanCalculator.js";
import {
  creditCompassDefinition,
  handleCreditCompass,
} from "./tools/creditCompass.js";
import {
  creditCompassWidgetResource,
  loanCalculatorWidgetResource,
  readCreditCompassWidget,
  readLoanCalculatorWidget,
  CREDIT_COMPASS_WIDGET_URI,
  LOAN_CALCULATOR_WIDGET_URI,
  WIDGET_MIME_TYPE,
} from "./appsSdk.js";

export const SERVER_NAME = "iwoca-business-finance";
export const SERVER_VERSION = "0.1.0";

export const TOOLS = [
  getProductInfoDefinition,
  loanCalculatorDefinition,
  creditCompassDefinition,
] as const;

type ToolHandler = (
  args: unknown,
) => Promise<{
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}>;

const HANDLERS: Record<string, ToolHandler> = {
  get_product_info: handleGetProductInfo,
  loan_calculator: handleLoanCalculator,
  credit_compass: handleCreditCompass,
};

/**
 * Build a fresh MCP Server wired to the three read-only iwoca tools. Each
 * transport (HTTP session or stdio) gets its own Server instance. The server is
 * stateless and read-only: no PII, no persistence, no session state tied to a
 * person (Phase 1).
 */
export function createMcpServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      // _meta is only present on tools that declare an Apps SDK widget.
      ...("_meta" in tool ? { _meta: tool._meta } : {}),
    })),
  }));

  // Resources: the HTML widgets (Apps SDK output templates).
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [creditCompassWidgetResource, loanCalculatorWidgetResource],
  }));

  const WIDGET_READERS: Record<string, () => string> = {
    [CREDIT_COMPASS_WIDGET_URI]: readCreditCompassWidget,
    [LOAN_CALCULATOR_WIDGET_URI]: readLoanCalculatorWidget,
  };

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const reader = WIDGET_READERS[request.params.uri];
    if (reader) {
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: WIDGET_MIME_TYPE,
            text: reader(),
          },
        ],
      };
    }
    throw new Error(`Unknown resource '${request.params.uri}'.`);
  });

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
