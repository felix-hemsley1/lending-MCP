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

test("widgets: tools advertise their Apps SDK output templates", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();

  const compass = tools.find((t) => t.name === "credit_compass");
  assert.ok(compass);
  assert.equal(
    (compass._meta as Record<string, unknown>)?.["openai/outputTemplate"],
    "ui://widget/credit-compass.html",
  );

  const calc = tools.find((t) => t.name === "loan_calculator");
  assert.ok(calc);
  assert.equal(
    (calc._meta as Record<string, unknown>)?.["openai/outputTemplate"],
    "ui://widget/loan-calculator.html",
  );

  // Both widget resources are listed and readable.
  const resources = await client.listResources();
  const uris = resources.resources.map((r) => r.uri).sort();
  assert.deepEqual(uris, [
    "ui://widget/credit-compass.html",
    "ui://widget/loan-calculator.html",
  ]);
  const read = await client.readResource({ uri: "ui://widget/loan-calculator.html" });
  assert.match(read.contents[0].text as string, /Loan Calculator/);
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
    arguments: { amount_gbp: 5_000_000, monthly_rate_pct: 3.3, term_months: 12 },
  });
  assert.equal(tooBig.isError, true);

  const badTerm = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 10_000, monthly_rate_pct: 3.3, term_months: 36 },
  });
  assert.equal(badTerm.isError, true);

  const rateTooHigh = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 10_000, monthly_rate_pct: 6, term_months: 12 },
  });
  assert.equal(rateTooHigh.isError, true);

  const earlyMissingDays = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 10_000, monthly_rate_pct: 3.3, term_months: 12, repay_early: true },
  });
  assert.equal(earlyMissingDays.isError, true);
});

test("loan_calculator returns a full-term cost plus a disclaimer", async () => {
  const client = await connectClient();

  const result = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 50_000, monthly_rate_pct: 3.3, term_months: 24 },
  });
  assert.notEqual(result.isError, true);

  const sc = result.structuredContent as {
    full_term: {
      interest_gbp: number;
      total_repayable_gbp: number;
      monthly_repayment_gbp: number;
    };
    early_repayment?: unknown;
    disclaimer: string;
  };
  assert.ok(sc.full_term.interest_gbp > 0);
  assert.ok(sc.full_term.total_repayable_gbp > 50_000);
  assert.ok(sc.full_term.monthly_repayment_gbp > 0);
  // Amortising payment must be well below the naive total/term of a bullet loan.
  assert.ok(sc.full_term.monthly_repayment_gbp * 24 < 50_000 * 2);
  assert.equal(sc.early_repayment, undefined);
  assert.match(sc.disclaimer, /daily/i);
});

test("loan_calculator charges interest on the reducing balance (declining per month)", async () => {
  const client = await connectClient();
  const result = await client.callTool({
    name: "loan_calculator",
    arguments: { amount_gbp: 50_000, monthly_rate_pct: 3.3, term_months: 24 },
  });
  const sc = result.structuredContent as {
    full_term: { first_month_interest_gbp: number; final_month_interest_gbp: number };
  };
  // Interest on the outstanding balance means month 1 > final month.
  assert.ok(
    sc.full_term.first_month_interest_gbp > sc.full_term.final_month_interest_gbp,
    "interest should fall as the balance reduces",
  );
});

test("loan_calculator applies the over-12-month term fee (5% / 6%)", async () => {
  const client = await connectClient();
  async function feeFor(term: number) {
    const r = await client.callTool({
      name: "loan_calculator",
      arguments: { amount_gbp: 50_000, monthly_rate_pct: 3.3, term_months: term },
    });
    return (r.structuredContent as { full_term: { fee_pct: number; fee_gbp: number } })
      .full_term;
  }
  const t12 = await feeFor(12);
  assert.equal(t12.fee_pct, 0);
  assert.equal(t12.fee_gbp, 0);
  const t24 = await feeFor(24);
  assert.equal(t24.fee_pct, 5);
  assert.equal(t24.fee_gbp, 2_500);
  const t48 = await feeFor(48);
  assert.equal(t48.fee_pct, 6);
  assert.equal(t48.fee_gbp, 3_000);
});

test("loan_calculator computes daily-interest early repayment with a saving", async () => {
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
    full_term: { interest_gbp: number };
    early_repayment: {
      days: number;
      interest_gbp: number;
      total_repayable_gbp: number;
      saving_vs_full_term_gbp: number;
    };
  };

  // Interest calculated daily: 50000 * (3.3/100/30) * 21 ≈ 1155
  const expected = 50_000 * (3.3 / 100 / 30) * 21;
  assert.ok(Math.abs(sc.early_repayment.interest_gbp - expected) < 0.5);
  assert.equal(sc.early_repayment.days, 21);
  assert.ok(sc.early_repayment.interest_gbp < sc.full_term.interest_gbp);
  assert.ok(sc.early_repayment.saving_vs_full_term_gbp > 0);
  assert.ok(sc.early_repayment.total_repayable_gbp < 50_000 + sc.full_term.interest_gbp);
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
