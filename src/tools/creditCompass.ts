import { z } from "zod";
import { creditCompassToolMeta } from "../appsSdk.js";

/**
 * iwoca Credit Compass — a DEMO / ILLUSTRATIVE view only.
 *
 * This is NOT a credit score or credit decision and uses NO real iwoca scoring
 * or credit data. The score is produced by deterministic illustrative logic on
 * the (optional) inputs so the same inputs always yield the same output. Per the
 * project ground rules, this must stay a clearly-labelled mock — do not connect
 * it to any real scoring source without an explicit human instruction.
 */

const SCORE_MIN = 35;
const SCORE_MAX = 90;
const BASE_SCORE = 62;

const DISCLAIMER =
  "DEMO / ILLUSTRATIVE ONLY. The iwoca Credit Compass shown here is not a credit " +
  "score, not a credit decision, and not an indication of what iwoca would offer. " +
  "It is generated from illustrative logic on the inputs you provided and uses no " +
  "real iwoca scoring or credit data.";

export const creditCompassDefinition = {
  name: "credit_compass",
  title: "iwoca Credit Compass (demo)",
  description:
    "Show the iwoca Credit Compass — a DEMO / ILLUSTRATIVE view of how a business " +
    "might look, not a real credit score or decision and using no real iwoca data. " +
    "All inputs are optional; it returns an illustrative score (35–90), a band, three " +
    "factors, and a disclaimer. Always present this as a demo, never as a credit outcome.",
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  _meta: creditCompassToolMeta,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      business_name: {
        type: "string",
        description: "Optional business (not personal) name to label the demo view.",
      },
      sector: {
        type: "string",
        description: "Optional broad business sector (illustrative only).",
      },
      years_trading: {
        type: "number",
        description: "Optional number of years the business has traded (illustrative).",
        minimum: 0,
        maximum: 100,
      },
      monthly_revenue_gbp: {
        type: "number",
        description: "Optional approximate monthly revenue in GBP (illustrative).",
        minimum: 0,
      },
    },
  },
} as const;

const inputSchema = z.object({
  business_name: z.string().trim().min(1).max(200).optional(),
  sector: z.string().trim().min(1).max(100).optional(),
  years_trading: z.number().min(0).max(100).optional(),
  monthly_revenue_gbp: z.number().min(0).optional(),
});

type Signal = "strong" | "steady" | "watch";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function bandFor(score: number): string {
  if (score >= 80) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 50) return "Fair";
  return "Developing";
}

export async function handleCreditCompass(rawArgs: unknown) {
  const parsed = inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: "Invalid input for credit_compass; all fields are optional but must be well-formed.",
        },
      ],
    };
  }

  const { business_name, sector, years_trading, monthly_revenue_gbp } = parsed.data;

  // Deterministic illustrative adjustments (not a real model).
  let score = BASE_SCORE;

  const tradingSignal: Signal =
    years_trading === undefined ? "steady" : years_trading >= 3 ? "strong" : years_trading >= 1 ? "steady" : "watch";
  if (years_trading !== undefined) {
    score += years_trading >= 3 ? 12 : years_trading >= 1 ? 4 : -8;
  }

  const cashflowSignal: Signal =
    monthly_revenue_gbp === undefined
      ? "steady"
      : monthly_revenue_gbp >= 25_000
        ? "strong"
        : monthly_revenue_gbp >= 5_000
          ? "steady"
          : "watch";
  if (monthly_revenue_gbp !== undefined) {
    score += monthly_revenue_gbp >= 25_000 ? 10 : monthly_revenue_gbp >= 5_000 ? 3 : -6;
  }

  // Third factor is a fixed illustrative headroom indicator.
  const affordabilitySignal: Signal = "steady";

  score = clamp(Math.round(score), SCORE_MIN, SCORE_MAX);
  const band = bandFor(score);

  const factors = [
    {
      name: "Trading history",
      signal: tradingSignal,
      note:
        years_trading === undefined
          ? "No trading history provided (illustrative default)."
          : `${years_trading} year(s) trading (illustrative).`,
    },
    {
      name: "Cash flow",
      signal: cashflowSignal,
      note:
        monthly_revenue_gbp === undefined
          ? "No revenue provided (illustrative default)."
          : `~£${monthly_revenue_gbp.toLocaleString("en-GB")}/month revenue (illustrative).`,
    },
    {
      name: "Affordability headroom",
      signal: affordabilitySignal,
      note: "Illustrative repayment headroom indicator (demo).",
    },
  ];

  const structuredContent = {
    demo: true as const,
    business_name: business_name ?? null,
    sector: sector ?? null,
    score,
    band,
    factors,
    disclaimer: DISCLAIMER,
  };

  const text = [
    `iwoca Credit Compass (DEMO)${business_name ? ` for ${business_name}` : ""}`,
    `Illustrative score: ${score}/100 — band: ${band}`,
    ...factors.map((f) => `- ${f.name}: ${f.signal} — ${f.note}`),
    ``,
    DISCLAIMER,
  ].join("\n");

  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}
