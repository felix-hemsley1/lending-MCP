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

test("tools/list returns the 4 read-only tools", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();

  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["credit_compass", "get_iwoca_info", "get_product_info", "loan_calculator"],
  );
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} readOnlyHint`);
    assert.equal(tool.annotations?.openWorldHint, false, `${tool.name} openWorldHint`);
  }
});

test("widgets: compass + calculator advertise Apps SDK templates; resources readable", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();

  const compass = tools.find((t) => t.name === "credit_compass");
  assert.equal(
    (compass?._meta as Record<string, unknown>)?.["openai/outputTemplate"],
    "ui://widget/credit-compass.html",
  );
  const calc = tools.find((t) => t.name === "loan_calculator");
  assert.equal(
    (calc?._meta as Record<string, unknown>)?.["openai/outputTemplate"],
    "ui://widget/loan-calculator.html",
  );

  const resources = await client.listResources();
  assert.deepEqual(resources.resources.map((r) => r.uri).sort(), [
    "ui://widget/credit-compass.html",
    "ui://widget/loan-calculator.html",
  ]);
  const read = await client.readResource({ uri: "ui://widget/loan-calculator.html" });
  assert.match(read.contents[0].text as string, /Loan Calculator/i);
});

test("get_iwoca_info serves knowledge topics with disclaimer; rejects bad topics", async () => {
  const client = await connectClient();

  const all = await client.callTool({ name: "get_iwoca_info", arguments: {} });
  const sc = all.structuredContent as { disclaimer: string; topics: Record<string, unknown> };
  for (const t of ["how_it_works", "use_cases", "comparison", "testimonials", "rates_and_fees", "eligibility"]) {
    assert.ok(sc.topics[t], `missing topic ${t}`);
  }
  assert.match(sc.disclaimer, /confirm|VERIFY|published/i);

  const one = await client.callTool({
    name: "get_iwoca_info",
    arguments: { topic: "testimonials" },
  });
  const oneSc = one.structuredContent as { topics: Record<string, { named_case_studies?: string }> };
  assert.deepEqual(Object.keys(oneSc.topics), ["testimonials"]);
  // Named case studies must never be invented — placeholder until real quotes supplied.
  assert.match(String(oneSc.topics.testimonials.named_case_studies), /\[VERIFY\]/);

  const bad = await client.callTool({ name: "get_iwoca_info", arguments: { topic: "nope" } });
  assert.equal(bad.isError, true);
});

test("get_product_info returns all products for 'all' and one for a specific id", async () => {
  const client = await connectClient();
  const all = await client.callTool({ name: "get_product_info", arguments: { product_id: "all" } });
  const allSc = all.structuredContent as { products: { id: string }[] };
  assert.ok(allSc.products.length >= 1);
  const one = await client.callTool({
    name: "get_product_info",
    arguments: { product_id: allSc.products[0].id },
  });
  assert.equal(
    (one.structuredContent as { product: { id: string } }).product.id,
    allSc.products[0].id,
  );
});

test("credit_compass returns demo estimate + non-guaranteed indicative rate", async () => {
  const client = await connectClient();
  const result = await client.callTool({
    name: "credit_compass",
    arguments: { business_name: "Acme Trading Ltd", years_trading: 4, monthly_revenue_gbp: 30_000 },
  });
  assert.notEqual(result.isError, true);
  const sc = result.structuredContent as {
    demo: boolean;
    data_source: string;
    score: number;
    band: string;
    factors: { signal: string }[];
    indicative_monthly_rate_pct: { low: number; mid: number; high: number; not_a_guarantee: boolean };
    disclaimer: string;
  };
  assert.equal(sc.demo, true);
  assert.equal(sc.data_source, "fake");
  assert.ok(sc.score >= 35 && sc.score <= 90);
  assert.equal(sc.factors.length, 3);
  for (const f of sc.factors) assert.ok(f.signal.length > 0);
  const r = sc.indicative_monthly_rate_pct;
  assert.equal(r.not_a_guarantee, true);
  assert.ok(r.low >= 1.5 && r.high <= 5.7 && r.mid >= r.low && r.mid <= r.high);
  assert.match(sc.disclaimer, /not a guarantee/i);
});

test("credit_compass: stronger business → lower indicative rate; deterministic", async () => {
  const client = await connectClient();
  const weak = await client.callTool({
    name: "credit_compass",
    arguments: { years_trading: 0, monthly_revenue_gbp: 1_000 },
  });
  const strong = await client.callTool({
    name: "credit_compass",
    arguments: { years_trading: 6, monthly_revenue_gbp: 60_000 },
  });
  const strong2 = await client.callTool({
    name: "credit_compass",
    arguments: { years_trading: 6, monthly_revenue_gbp: 60_000 },
  });
  const mid = (r: unknown) =>
    (r as { indicative_monthly_rate_pct: { mid: number } }).indicative_monthly_rate_pct.mid;
  assert.ok(mid(strong.structuredContent) < mid(weak.structuredContent));
  assert.equal(mid(strong.structuredContent), mid(strong2.structuredContent));
});

test("loan_calculator: reducing balance, term fee, early repayment, apply link", async () => {
  const client = await connectClient();

  const result = await client.callTool({
    name: "loan_calculator",
    arguments: {
      amount_gbp: 50_000,
      monthly_rate_pct: 3.3,
      term_months: 24,
      repay_early: true,
      early_repayment_days: 21,
    },
  });
  assert.notEqual(result.isError, true);
  const sc = result.structuredContent as {
    full_term: {
      monthly_repayment_gbp: number;
      first_month_interest_gbp: number;
      final_month_interest_gbp: number;
      fee_pct: number;
      fee_gbp: number;
    };
    early_repayment: { interest_gbp: number; saving_vs_full_term_gbp: number };
    application_url: string;
  };
  // Interest on the outstanding balance: month 1 > final month.
  assert.ok(sc.full_term.first_month_interest_gbp > sc.full_term.final_month_interest_gbp);
  // 24 months → 5% fee.
  assert.equal(sc.full_term.fee_pct, 5);
  assert.equal(sc.full_term.fee_gbp, 2_500);
  // Early repayment saves interest.
  assert.ok(sc.early_repayment.saving_vs_full_term_gbp > 0);
  assert.ok(/^https?:\/\//.test(sc.application_url));

  // 12 months → no fee; 48 → 6%.
  const t12 = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 50_000, term_months: 12 },
  });
  assert.equal((t12.structuredContent as { full_term: { fee_pct: number } }).full_term.fee_pct, 0);
  const t48 = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 50_000, term_months: 48 },
  });
  assert.equal((t48.structuredContent as { full_term: { fee_pct: number } }).full_term.fee_pct, 6);
});

test("loan_calculator rejects out-of-range input; defaults to representative rate", async () => {
  const client = await connectClient();
  const bad = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 5_000_000 },
  });
  assert.equal(bad.isError, true);
  const badTerm = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 10_000, term_months: 36 },
  });
  assert.equal(badTerm.isError, true);

  const defaulted = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 10_000 },
  });
  assert.equal(
    (defaulted.structuredContent as { monthly_rate_pct: number }).monthly_rate_pct,
    3.3,
  );
});
