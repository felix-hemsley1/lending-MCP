import { z } from "zod";

/**
 * Loan repayment estimator.
 *
 * IMPORTANT: this tool NEVER assumes an iwoca interest rate. iwoca's real rates
 * are not published here (they are [VERIFY] placeholders), so the caller must
 * supply an *illustrative* annual interest-rate range. The tool amortises the
 * amount over the term at the low and high rate to produce low/high estimates.
 *
 * The amount / term bounds below are calculator input guards only — they are
 * NOT iwoca lending limits.
 */

const AMOUNT_MIN = 1_000;
const AMOUNT_MAX = 1_000_000;
const TERM_MIN = 1;
const TERM_MAX = 120;
const RATE_MIN = 0;
const RATE_MAX = 100;

const DISCLAIMER =
  "Illustrative estimate only, based on the interest-rate range you provided — " +
  "not a quote, an offer, or a financial promotion from iwoca. Actual rates, fees, " +
  "and repayments depend on iwoca's assessment and published terms.";

export const loanCalculatorDefinition = {
  name: "loan_calculator",
  title: "Estimate loan repayments",
  description:
    "Estimate monthly repayments and total repayable for a business loan, amortised " +
    "over the term. You must supply an illustrative annual interest-rate range " +
    "(min_annual_rate_pct / max_annual_rate_pct) — iwoca's actual rates are not " +
    "provided by this tool. Returns low and high estimates plus a disclaimer.",
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: [
      "amount_gbp",
      "term_months",
      "min_annual_rate_pct",
      "max_annual_rate_pct",
    ],
    properties: {
      amount_gbp: {
        type: "number",
        description: `Loan amount in GBP (calculator range ${AMOUNT_MIN}–${AMOUNT_MAX}).`,
        minimum: AMOUNT_MIN,
        maximum: AMOUNT_MAX,
      },
      term_months: {
        type: "integer",
        description: `Repayment term in whole months (${TERM_MIN}–${TERM_MAX}).`,
        minimum: TERM_MIN,
        maximum: TERM_MAX,
      },
      min_annual_rate_pct: {
        type: "number",
        description:
          "Low end of the illustrative annual interest rate, in percent (e.g. 8 for 8%).",
        minimum: RATE_MIN,
        maximum: RATE_MAX,
      },
      max_annual_rate_pct: {
        type: "number",
        description:
          "High end of the illustrative annual interest rate, in percent. Must be >= min.",
        minimum: RATE_MIN,
        maximum: RATE_MAX,
      },
    },
  },
} as const;

const inputSchema = z
  .object({
    amount_gbp: z.number().min(AMOUNT_MIN).max(AMOUNT_MAX),
    term_months: z.number().int().min(TERM_MIN).max(TERM_MAX),
    min_annual_rate_pct: z.number().min(RATE_MIN).max(RATE_MAX),
    max_annual_rate_pct: z.number().min(RATE_MIN).max(RATE_MAX),
  })
  .refine((v) => v.max_annual_rate_pct >= v.min_annual_rate_pct, {
    message: "max_annual_rate_pct must be greater than or equal to min_annual_rate_pct",
    path: ["max_annual_rate_pct"],
  });

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Standard amortised (annuity) monthly payment. */
function estimate(amount: number, termMonths: number, annualRatePct: number) {
  const monthlyRate = annualRatePct / 100 / 12;
  const monthly =
    monthlyRate === 0
      ? amount / termMonths
      : (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));
  const totalRepayable = monthly * termMonths;
  return {
    annual_rate_pct: annualRatePct,
    monthly_repayment_gbp: round2(monthly),
    total_repayable_gbp: round2(totalRepayable),
    total_interest_gbp: round2(totalRepayable - amount),
  };
}

export async function handleLoanCalculator(rawArgs: unknown) {
  const parsed = inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`)
      .join("; ");
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: `Input out of range or invalid: ${detail}`,
        },
      ],
    };
  }

  const { amount_gbp, term_months, min_annual_rate_pct, max_annual_rate_pct } =
    parsed.data;

  const low = estimate(amount_gbp, term_months, min_annual_rate_pct);
  const high = estimate(amount_gbp, term_months, max_annual_rate_pct);

  const structuredContent = {
    amount_gbp,
    term_months,
    low,
    high,
    disclaimer: DISCLAIMER,
  };

  const text = [
    `Estimated repayments for £${amount_gbp.toLocaleString("en-GB")} over ${term_months} month(s):`,
    `- Low (${low.annual_rate_pct}%): £${low.monthly_repayment_gbp.toLocaleString("en-GB")}/mo, total £${low.total_repayable_gbp.toLocaleString("en-GB")}`,
    `- High (${high.annual_rate_pct}%): £${high.monthly_repayment_gbp.toLocaleString("en-GB")}/mo, total £${high.total_repayable_gbp.toLocaleString("en-GB")}`,
    ``,
    DISCLAIMER,
  ].join("\n");

  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}
