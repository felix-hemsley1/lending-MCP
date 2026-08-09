import { z } from "zod";
import { iwocaFinanceToolMeta } from "../appsSdk.js";
import { APPLICATION_URL } from "../config.js";
import {
  RATE_MIN,
  RATE_MAX,
  TERMS,
  creditCompass,
  indicativeMonthlyRate,
  monthlyPayment,
  feePct,
  round2,
} from "../finance.js";

const AMOUNT_MIN = 1_000;
const AMOUNT_MAX = 1_000_000;
const TERM_DEFAULT = 24;

const DISCLAIMER =
  "DEMO / ILLUSTRATIVE ONLY. The Credit Compass estimate is a demo and uses no real " +
  "iwoca scoring or credit data. The indicative interest rate is a ROUGH ESTIMATE, " +
  "NOT A GUARANTEE and not iwoca's real pricing. Any cost figures are illustrative " +
  "estimates, not a quote or an offer. For an exact amount and rate, apply to iwoca — " +
  "eligibility, rates and terms are subject to iwoca's assessment.";

export const financeEstimatorDefinition = {
  name: "iwoca_finance_estimator",
  title: "iwoca finance estimator",
  description:
    "Guided iwoca business-finance journey. Collect (in conversation) how much the " +
    "user wants and what for, then business details (e.g. limited company name, years " +
    "trading, monthly revenue), and pass them here. Returns a DEMO Credit Compass " +
    "estimate and a ROUGH, NON-GUARANTEED indicative monthly interest rate, an " +
    "illustrative cost preview, and an application link for an exact rate from iwoca. " +
    "Always present the rate as a rough estimate, never a guarantee or a real iwoca offer.",
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  _meta: iwocaFinanceToolMeta,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      amount_gbp: {
        type: "number",
        description: `How much the user wants to borrow, GBP (${AMOUNT_MIN}-${AMOUNT_MAX}).`,
        minimum: AMOUNT_MIN,
        maximum: AMOUNT_MAX,
      },
      purpose: {
        type: "string",
        description: "What the capital is for (e.g. stock, equipment, cash flow, expansion).",
      },
      business_name: {
        type: "string",
        description: "Business (not personal) name, e.g. the limited company name.",
      },
      sector: { type: "string", description: "Broad business sector (illustrative)." },
      years_trading: {
        type: "number",
        description: "Years the business has traded (illustrative).",
        minimum: 0,
        maximum: 100,
      },
      monthly_revenue_gbp: {
        type: "number",
        description: "Approximate monthly revenue in GBP (illustrative).",
        minimum: 0,
      },
      term_months: {
        type: "integer",
        description: `Preferred term in months — one of ${TERMS.join(", ")}. Defaults to ${TERM_DEFAULT}.`,
        enum: [...TERMS],
      },
    },
  },
} as const;

const inputSchema = z.object({
  amount_gbp: z.number().min(AMOUNT_MIN).max(AMOUNT_MAX).optional(),
  purpose: z.string().trim().min(1).max(200).optional(),
  business_name: z.string().trim().min(1).max(200).optional(),
  sector: z.string().trim().min(1).max(100).optional(),
  years_trading: z.number().min(0).max(100).optional(),
  monthly_revenue_gbp: z.number().min(0).optional(),
  term_months: z
    .number()
    .int()
    .refine((v) => (TERMS as readonly number[]).includes(v), {
      message: `term_months must be one of ${TERMS.join(", ")}`,
    })
    .optional(),
});

export async function handleFinanceEstimator(rawArgs: unknown) {
  const parsed = inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`)
      .join("; ");
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: `Invalid input: ${detail}` }],
    };
  }

  const {
    amount_gbp,
    purpose,
    business_name,
    sector,
    years_trading,
    monthly_revenue_gbp,
    term_months,
  } = parsed.data;

  const estimate = creditCompass({ years_trading, monthly_revenue_gbp });
  const rate = indicativeMonthlyRate(estimate.score);
  const term = term_months ?? TERM_DEFAULT;

  let costPreview: Record<string, unknown> | null = null;
  if (amount_gbp !== undefined) {
    const i = rate.mid / 100;
    const payment = monthlyPayment(amount_gbp, i, term);
    const interest = payment * term - amount_gbp;
    const fee = amount_gbp * (feePct(term) / 100);
    costPreview = {
      term_months: term,
      monthly_rate_pct: rate.mid,
      monthly_repayment_gbp: round2(payment),
      interest_gbp: round2(interest),
      fee_pct: feePct(term),
      fee_gbp: round2(fee),
      total_repayable_gbp: round2(payment * term + fee),
    };
  }

  const structuredContent = {
    demo: true as const,
    amount_gbp: amount_gbp ?? null,
    purpose: purpose ?? null,
    business_name: business_name ?? null,
    sector: sector ?? null,
    estimate: { score: estimate.score, band: estimate.band, factors: estimate.factors },
    indicative_monthly_rate_pct: {
      low: rate.low,
      mid: rate.mid,
      high: rate.high,
      not_a_guarantee: true as const,
    },
    suggested_term_months: term,
    cost_preview: costPreview,
    application_url: APPLICATION_URL,
    disclaimer: DISCLAIMER,
  };

  const lines = [
    `iwoca finance estimate (DEMO)${business_name ? ` for ${business_name}` : ""}:`,
    `- Credit Compass (demo): ${estimate.score}/100 — ${estimate.band}`,
    `- Rough indicative rate (NOT a guarantee, not iwoca's real pricing): ~${rate.mid}%/month (range ${rate.low}-${rate.high}%, ${RATE_MIN}-${RATE_MAX}% possible).`,
  ];
  if (costPreview) {
    lines.push(
      `- At ~${rate.mid}%/month over ${term} months for £${amount_gbp!.toLocaleString("en-GB")}: ~£${(costPreview.monthly_repayment_gbp as number).toLocaleString("en-GB")}/month, total ~£${(costPreview.total_repayable_gbp as number).toLocaleString("en-GB")}.`,
    );
  }
  lines.push(
    `- For an exact amount and rate, apply to iwoca: ${APPLICATION_URL}`,
    "",
    DISCLAIMER,
  );

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent,
  };
}
