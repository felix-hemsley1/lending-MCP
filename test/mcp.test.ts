import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";

/**
 * Drive the real MCP server over an in-memory transport with a real MCP client
 * — exercises initialize + tools/list + tools/call through genuine JSON-RPC.
 */
async function connectClient(): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

test("tools/list returns the 2 read-only tools", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();

  assert.equal(tools.length, 2);
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["get_product_info", "iwoca_finance_estimator"],
  );
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} readOnlyHint`);
    assert.equal(tool.annotations?.openWorldHint, false, `${tool.name} openWorldHint`);
  }
});

test("finance estimator advertises its widget and the resource is readable", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  const est = tools.find((t) => t.name === "iwoca_finance_estimator");
  assert.ok(est);
  assert.equal(
    (est._meta as Record<string, unknown>)?.["openai/outputTemplate"],
    "ui://widget/iwoca-finance.html",
  );

  const resources = await client.listResources();
  assert.deepEqual(
    resources.resources.map((r) => r.uri),
    ["ui://widget/iwoca-finance.html"],
  );
  const read = await client.readResource({ uri: "ui://widget/iwoca-finance.html" });
  assert.match(read.contents[0].text as string, /iwoca finance estimator/i);
});

test("get_product_info returns all products for 'all' and one for a specific id", async () => {
  const client = await connectClient();

  const all = await client.callTool({
    name: "get_product_info",
    arguments: { product_id: "all" },
  });
  const allSc = all.structuredContent as { products: { id: string }[]; disclaimer: string };
  assert.ok(Array.isArray(allSc.products) && allSc.products.length >= 1);
  assert.match(allSc.disclaimer, /\[VERIFY\]|not.*offer|placeholder/i);

  const firstId = allSc.products[0].id;
  const one = await client.callTool({
    name: "get_product_info",
    arguments: { product_id: firstId },
  });
  assert.equal((one.structuredContent as { product: { id: string } }).product.id, firstId);

  const missing = await client.callTool({
    name: "get_product_info",
    arguments: { product_id: "does-not-exist" },
  });
  assert.equal(missing.isError, true);
});

test("finance estimator rejects out-of-range input", async () => {
  const client = await connectClient();

  const tooBig = await client.callTool({
    name: "iwoca_finance_estimator",
    arguments: { amount_gbp: 5_000_000 },
  });
  assert.equal(tooBig.isError, true);

  const badTerm = await client.callTool({
    name: "iwoca_finance_estimator",
    arguments: { amount_gbp: 50_000, term_months: 36 },
  });
  assert.equal(badTerm.isError, true);
});

test("finance estimator returns a demo estimate, a non-guaranteed rate, and an apply link", async () => {
  const client = await connectClient();

  const result = await client.callTool({
    name: "iwoca_finance_estimator",
    arguments: {
      amount_gbp: 50_000,
      purpose: "stock",
      business_name: "Acme Trading Ltd",
      years_trading: 4,
      monthly_revenue_gbp: 30_000,
      term_months: 24,
    },
  });
  assert.notEqual(result.isError, true);

  const sc = result.structuredContent as {
    demo: boolean;
    estimate: { score: number; band: string; factors: { signal: string }[] };
    indicative_monthly_rate_pct: { low: number; mid: number; high: number; not_a_guarantee: boolean };
    cost_preview: { monthly_repayment_gbp: number; fee_pct: number; fee_gbp: number; total_repayable_gbp: number } | null;
    application_url: string;
    disclaimer: string;
  };

  assert.equal(sc.demo, true);
  // Credit Compass (demo)
  assert.ok(sc.estimate.score >= 35 && sc.estimate.score <= 90);
  assert.ok(sc.estimate.band.length > 0);
  assert.equal(sc.estimate.factors.length, 3);
  for (const f of sc.estimate.factors) assert.ok(f.signal.length > 0);

  // Rough, non-guaranteed indicative rate within the illustrative range
  const r = sc.indicative_monthly_rate_pct;
  assert.equal(r.not_a_guarantee, true);
  assert.ok(r.low >= 1.5 && r.high <= 5.7 && r.mid >= r.low && r.mid <= r.high);

  // Cost preview uses the mid rate, includes the over-12-month fee
  assert.ok(sc.cost_preview);
  assert.ok(sc.cost_preview!.monthly_repayment_gbp > 0);
  assert.equal(sc.cost_preview!.fee_pct, 5); // 24 months
  assert.equal(sc.cost_preview!.fee_gbp, 2_500);
  assert.ok(sc.cost_preview!.total_repayable_gbp > 50_000);

  assert.ok(/^https?:\/\//.test(sc.application_url));
  assert.match(sc.disclaimer, /not a guarantee/i);
});

test("finance estimator: no amount → no cost preview; rate is deterministic", async () => {
  const client = await connectClient();
  const a = await client.callTool({ name: "iwoca_finance_estimator", arguments: { years_trading: 2 } });
  const b = await client.callTool({ name: "iwoca_finance_estimator", arguments: { years_trading: 2 } });
  const scA = a.structuredContent as { cost_preview: unknown; indicative_monthly_rate_pct: { mid: number } };
  const scB = b.structuredContent as { indicative_monthly_rate_pct: { mid: number } };
  assert.equal(scA.cost_preview, null);
  assert.equal(scA.indicative_monthly_rate_pct.mid, scB.indicative_monthly_rate_pct.mid);
});

test("finance estimator: a stronger business gets a lower indicative rate", async () => {
  const client = await connectClient();
  const weak = await client.callTool({
    name: "iwoca_finance_estimator",
    arguments: { years_trading: 0, monthly_revenue_gbp: 1_000 },
  });
  const strong = await client.callTool({
    name: "iwoca_finance_estimator",
    arguments: { years_trading: 6, monthly_revenue_gbp: 60_000 },
  });
  const rw = (weak.structuredContent as { indicative_monthly_rate_pct: { mid: number } }).indicative_monthly_rate_pct.mid;
  const rs = (strong.structuredContent as { indicative_monthly_rate_pct: { mid: number } }).indicative_monthly_rate_pct.mid;
  assert.ok(rs < rw, `stronger business should get a lower rate (${rs} < ${rw})`);
});
