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
  getIwocaInfoDefinition,
  handleGetIwocaInfo,
} from "./tools/getIwocaInfo.js";
import {
  creditCompassDefinition,
  handleCreditCompass,
} from "./tools/creditCompass.js";
import {
  loanCalculatorDefinition,
  handleLoanCalculator,
} from "./tools/loanCalculator.js";
import {
  lookupCompanyDefinition,
  handleLookupCompany,
} from "./tools/lookupCompany.js";
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

/**
 * Chat-first design: the host model carries the conversation (how iwoca works,
 * use cases, comparisons, reviews — via the knowledge tools) and surfaces the
 * compass / calculator widgets contextually when the user wants an estimate or
 * a cost view.
 */
export const TOOLS = [
  getIwocaInfoDefinition,
  getProductInfoDefinition,
  lookupCompanyDefinition,
  creditCompassDefinition,
  loanCalculatorDefinition,
] as const;

type ToolHandler = (
  args: unknown,
) => Promise<{
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}>;

const HANDLERS: Record<string, ToolHandler> = {
  get_iwoca_info: handleGetIwocaInfo,
  get_product_info: handleGetProductInfo,
  lookup_company: handleLookupCompany,
  credit_compass: handleCreditCompass,
  loan_calculator: handleLoanCalculator,
};

/**
 * Build a fresh MCP Server wired to the read-only iwoca tools. Each transport
 * (HTTP session or stdio) gets its own Server instance. The server is stateless
 * and read-only: no PII, no persistence, no session state tied to a person.
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
      ...("_meta" in tool ? { _meta: tool._meta } : {}),
    })),
  }));

  // Resources: the two chat-surfaced HTML widgets (Apps SDK output templates).
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
          { type: "text", text: `Unknown tool '${request.params.name}'.` },
        ],
      };
    }
    return handler(request.params.arguments ?? {});
  });

  return server;
}
