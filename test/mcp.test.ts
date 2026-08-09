import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";

/**
 * Spin up the real MCP server over an in-memory transport pair and drive it
 * with a real MCP client. This exercises initialize + tools/list + tools/call
 * through genuine JSON-RPC serialization — the same createMcpServer() used by
 * both the HTTP and stdio entry points.
 */
async function connectClient(): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(clientTransport);
  return client;
}

test("tools/list returns the 3 read-only tools", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();

  assert.equal(tools.length, 3);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["credit_compass", "get_product_info", "loan_calculator"]);

  for (const tool of tools) {
    assert.equal(
      tool.annotations?.readOnlyHint,
      true,
      `${tool.name} must be readOnlyHint: true`,
    );
    assert.equal(
      tool.annotations?.openWorldHint,
      false,
      `${tool.name} must be openWorldHint: false`,
    );
  }
});

test("credit_compass advertises its Apps SDK output template", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  const compass = tools.find((t) => t.name === "credit_compass");
  assert.ok(compass);
  assert.equal(
    (compass._meta as Record<string, unknown>)?.["openai/outputTemplate"],
    "ui://widget/credit-compass.html",
  );
});

test("get_product_info returns all products for 'all' and one for a specific id", async () => {
  const client = await connectClient();

  const all = await client.callTool({
    name: "get_product_info",
    arguments: { product_id: "all" },
  });
  const allSc = all.structuredContent as { products: { id: string }[]; disclaimer: string };
  assert.ok(Array.isArray(allSc.products));
  assert.ok(allSc.products.length >= 1);
  assert.match(allSc.disclaimer, /\[VERIFY\]|not.*offer|placeholder/i);

  const firstId = allSc.products[0].id;
  const one = await client.callTool({
    name: "get_product_info",
    arguments: { product_id: firstId },
  });
  const oneSc = one.structuredContent as { product: { id: string } };
  assert.equal(oneSc.product.id, firstId);

  const missing = await client.callTool({
    name: "get_product_info",
    arguments: { product_id: "does-not-exist" },
  });
  assert.equal(missing.isError, true);
});

test("loan_calculator rejects out-of-range input", async () => {
  const client = await connectClient();

  const tooBig = await client.callTool({
    name: "loan_calculator",
    arguments: {
      amount_gbp: 5_000_000,
      term_months: 12,
      min_annual_rate_pct: 5,
      max_annual_rate_pct: 10,
    },
  });
  assert.equal(tooBig.isError, true);

  const badTerm = await client.callTool({
    name: "loan_calculator",
    arguments: {
      amount_gbp: 10_000,
      term_months: 0,
      min_annual_rate_pct: 5,
      max_annual_rate_pct: 10,
    },
  });
  assert.equal(badTerm.isError, true);

  const badRange = await client.callTool({
    name: "loan_calculator",
    arguments: {
      amount_gbp: 10_000,
      term_months: 12,
      min_annual_rate_pct: 10,
      max_annual_rate_pct: 5,
    },
  });
  assert.equal(badRange.isError, true);
});

test("loan_calculator returns low/high estimates plus a disclaimer", async () => {
  const client = await connectClient();

  const result = await client.callTool({
    name: "loan_calculator",
    arguments: {
      amount_gbp: 10_000,
      term_months: 12,
      min_annual_rate_pct: 6,
      max_annual_rate_pct: 12,
    },
  });
  assert.notEqual(result.isError, true);

  const sc = result.structuredContent as {
    low: { monthly_repayment_gbp: number; total_repayable_gbp: number };
    high: { monthly_repayment_gbp: number; total_repayable_gbp: number };
    disclaimer: string;
  };
  assert.ok(sc.low && sc.high);
  assert.ok(sc.low.monthly_repayment_gbp > 0);
  assert.ok(sc.high.monthly_repayment_gbp > sc.low.monthly_repayment_gbp);
  assert.ok(sc.high.total_repayable_gbp > 10_000);
  assert.ok(sc.disclaimer.length > 0);
});

test("credit_compass returns a scored, banded, factored demo view", async () => {
  const client = await connectClient();

  const result = await client.callTool({
    name: "credit_compass",
    arguments: { business_name: "Acme Widgets Ltd", years_trading: 4, monthly_revenue_gbp: 30_000 },
  });
  assert.notEqual(result.isError, true);

  const sc = result.structuredContent as {
    score: number;
    band: string;
    factors: { name: string; signal: string }[];
    demo: boolean;
    disclaimer: string;
  };

  assert.equal(sc.demo, true);
  assert.ok(sc.score >= 35 && sc.score <= 90, `score ${sc.score} out of 35-90`);
  assert.ok(typeof sc.band === "string" && sc.band.length > 0);
  assert.equal(sc.factors.length, 3);
  for (const f of sc.factors) {
    assert.ok(typeof f.signal === "string" && f.signal.length > 0, "each factor needs a signal");
  }
  assert.match(sc.disclaimer, /demo|illustrative/i);
});

test("credit_compass is deterministic and clamps to 35-90 with no inputs", async () => {
  const client = await connectClient();
  const a = await client.callTool({ name: "credit_compass", arguments: {} });
  const b = await client.callTool({ name: "credit_compass", arguments: {} });
  const scA = a.structuredContent as { score: number };
  const scB = b.structuredContent as { score: number };
  assert.equal(scA.score, scB.score);
  assert.ok(scA.score >= 35 && scA.score <= 90);
});
