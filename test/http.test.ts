import { test } from "node:test";
import assert from "node:assert/strict";

import { buildServer } from "../src/server.js";

/**
 * Smoke test the real Fastify HTTP server: it must boot and report the 3 tools
 * on /healthz. (Full MCP protocol behaviour is covered in mcp.test.ts via the
 * in-memory transport.)
 */
test("HTTP server boots and /healthz reports the tools", async () => {
  const app = await buildServer();
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const res = await fetch(`${address}/healthz`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; tools: string[] };
    assert.equal(body.status, "ok");
    assert.deepEqual(
      body.tools.sort(),
      ["get_product_info", "iwoca_finance_estimator"],
    );
  } finally {
    await app.close();
  }
});
