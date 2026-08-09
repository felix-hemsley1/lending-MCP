import { z } from "zod";
import { loanCalculatorToolMeta } from "../appsSdk.js";
import { APPLICATION_URL } from "../config.js";
import {
  RATE_MIN,
  RATE_MAX,
  REP_RATE_PCT,
  TERMS,
  DAYS_PER_MONTH,
  monthlyPayment,
  firstAndFinalInterest,
  earlySettlement,
  feePct,
  round2,
} from "../finance.js";

/**
 * Loan cost calculator — surfaces in chat when the user wants to see what a
 * loan could cost. Amortising schedule (interest charged daily on the
 * outstanding balance), over-12-month fee, early-repayment savings, and the
 * application link for an exact rate. If a credit_compass estimate was shown
 * first, pass its indicative rate here so the widget opens prefilled.
 */

const AMOUNT_MIN = 1_000;
const AMOUNT_MAX = 1_000_000;
const TERM_DEFAULT = 24;

const DISCLAIMER =
  "Illustrative estimate only — not a quote, an offer, or a financial promotion " +
  "from iwoca. Interest is charged daily on the outstanding balance ((monthly rate " +
  "÷ 30) per day), so the interest part of each repayment falls over time. " +
  "Borrowing over 12 months may incur an additional fee (typically 5% for 13-24 " +
  "months, 6% for longer). Repaying early has no fee — you only pay interest up to " +
  `the day you settle. Any rate used here is a rough, non-guaranteed estimate (iwoca's ` +
  `representative rate is ${REP_RATE_PCT}% per month); your actual amount, rate and terms are ` +
  "confirmed by iwoca after assessment.";

export const loanCalculatorDefinition = {
  name: "loan_calculator",
  title: "Loan cost calculator",
  description:
    "Show what an iwoca loan could cost. Pass an amount, a monthly rate " +
    `(${RATE_MIN}-${RATE_MAX}%, default the representative ${REP_RATE_PCT}% — or the indicative rate from ` +
    "a credit_compass estimate if one was just shown), and a term (12/24/48/60 " +
    "months). Interest is charged daily on the reducing balance; over-12-month " +
    "borrowing may add a fee; repaying early is free (pass repay_early + " +
    "early_repayment_days to preview the saving). Returns the schedule plus an " +
    "application link — offer it when the user wants an exact amount and rate from iwoca. " +
    "Make clear every rate here is a rough estimate, not a guarantee.",
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  _meta: loanCalculatorToolMeta,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["amount_gbp"],
    properties: {
      amount_gbp: {
        type: "number",
        description: `Loan amount in GBP (${AMOUNT_MIN}-${AMOUNT_MAX}).`,
        minimum: AMOUNT_MIN,
        maximum: AMOUNT_MAX,
      },
      monthly_rate_pct: {
        type: "number",
        description: `Monthly interest rate, percent (${RATE_MIN}-${RATE_MAX}). Defaults to ${REP_RATE_PCT} (representative).`,
        minimum: RATE_MIN,
        maximum: RATE_MAX,
      },
      term_months: {
        type: "integer",
        description: `Term in months — one of ${TERMS.join(", ")}. Defaults to ${TERM_DEFAULT}.`,
        enum: [...TERMS],
      },
      repay_early: {
        type: "boolean",
        description: "True if the user plans to repay early (no fees). Requires early_repayment_days.",
      },
      early_repayment_days: {
        type: "integer",
        description: "Days until full early repayment (e.g. 1, 21 for 3 weeks, 120 for 4 months).",
        minimum: 1,
      },
    },
  },
} as const;

const inputSchema = z
  .object({
    amount_gbp: z.number().min(AMOUNT_MIN).max(AMOUNT_MAX),
    monthly_rate_pct: z.number().min(RATE_MIN).max(RATE_MAX).default(REP_RATE_PCT),
    term_months: z
      .number()
      .int()
      .refine((v) => (TERMS as readonly number[]).includes(v), {
        message: `term_months must be one of ${TERMS.join(", ")}`,
      })
      .default(TERM_DEFAULT),
    repay_early: z.boolean().default(false),
    early_repayment_days: z.number().int().min(1).optional(),
  })
  .refine((v) => !v.repay_early || v.early_repayment_days !== undefined, {
    message: "early_repayment_days is required when repay_early is true",
    path: ["early_repayment_days"],
  })
  .refine(
    (v) =>
      v.early_repayment_days === undefined ||
      v.early_repayment_days <= v.term_months * DAYS_PER_MONTH,
    {
      message: "early_repayment_days cannot exceed the full term",
      path: ["early_repayment_days"],
    },
  );

export async function handleLoanCalculator(rawArgs: unknown) {
  const parsed = inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`)
      .join("; ");
    return {
      isError: true as const,
      content: [
        { type: "text" as const, text: `Input out of range or invalid: ${detail}` },
      ],
    };
  }

  const { amount_gbp, monthly_rate_pct, term_months, repay_early, early_repayment_days } =
    parsed.data;

  const i = monthly_rate_pct / 100;
  const payment = monthlyPayment(amount_gbp, i, term_months);
  const fullInterest = payment * term_months - amount_gbp;
  const fee = amount_gbp * (feePct(term_months) / 100);
  const fullTotal = payment * term_months + fee;
  const { first, final } = firstAndFinalInterest(amount_gbp, i, payment, term_months);

  const structuredContent: Record<string, unknown> = {
    amount_gbp,
    monthly_rate_pct,
    term_months,
    full_term: {
      monthly_repayment_gbp: round2(payment),
      interest_gbp: round2(fullInterest),
      first_month_interest_gbp: round2(first),
      final_month_interest_gbp: round2(final),
      fee_pct: feePct(term_months),
      fee_gbp: round2(fee),
      total_repayable_gbp: round2(fullTotal),
    },
    application_url: APPLICATION_URL,
    disclaimer: DISCLAIMER,
  };

  const feeNote =
    fee > 0
      ? `, plus a ${feePct(term_months)}% fee (£${round2(fee).toLocaleString("en-GB")})`
      : "";
  const lines = [
    `Illustrative cost for £${amount_gbp.toLocaleString("en-GB")} at ${monthly_rate_pct}%/month over ${term_months} months:`,
    `- Full term: £${round2(payment).toLocaleString("en-GB")}/month, interest £${round2(fullInterest).toLocaleString("en-GB")}${feeNote}, total repayable £${round2(fullTotal).toLocaleString("en-GB")}`,
    `- Interest falls each month as the balance reduces (£${round2(first).toLocaleString("en-GB")} in month 1 → £${round2(final).toLocaleString("en-GB")} in the final month).`,
  ];

  if (repay_early && early_repayment_days !== undefined) {
    const { totalRepaid, interestPaid } = earlySettlement(
      amount_gbp,
      i,
      payment,
      early_repayment_days,
    );
    const earlyTotal = totalRepaid + fee;
    const saving = fullInterest - interestPaid;
    structuredContent.early_repayment = {
      days: early_repayment_days,
      interest_gbp: round2(interestPaid),
      fee_gbp: round2(fee),
      total_repayable_gbp: round2(earlyTotal),
      saving_vs_full_term_gbp: round2(saving),
    };
    lines.push(
      `- Repaid early after ${early_repayment_days} day(s): interest £${round2(interestPaid).toLocaleString("en-GB")}${feeNote}, total £${round2(earlyTotal).toLocaleString("en-GB")} — saving £${round2(saving).toLocaleString("en-GB")} of interest (no early-repayment fee)`,
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
