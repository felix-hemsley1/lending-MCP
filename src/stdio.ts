import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./mcp.js";

/**
 * Stdio entry point for local testing with the MCP Inspector or any stdio MCP
 * client. The Inspector can launch this directly:
 *
 *   npx @modelcontextprotocol/inspector node dist/stdio.js
 *
 * NOTE: stdout is reserved for the JSON-RPC protocol stream, so all logging
 * here must go to stderr only.
 */
async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `${SERVER_NAME} v${SERVER_VERSION} ready on stdio (3 tools)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`Failed to start iwoca MCP stdio server: ${String(err)}\n`);
  process.exit(1);
});
