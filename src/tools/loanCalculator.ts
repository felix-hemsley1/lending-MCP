import { z } from "zod";
import { loanCalculatorToolMeta } from "../appsSdk.js";

/**
 * Loan cost calculator.
 *
 * Method (illustrative, transparent):
 *  - The chosen term is a standard amortising schedule of equal monthly
 *    repayments, computed with the annuity formula at the monthly rate. Because a
 *    30-day month at (monthly rate ÷ 30) per day equals the monthly rate, this is
 *    consistent with "interest calculated daily" on the outstanding balance.
 *  - Repaying early settles the outstanding balance on the chosen day. Interest is
 *    accrued daily up to that day only, so you save the remaining interest — with
 *    no early-repayment fee.
 *
 * This is a clearly-labelled ESTIMATE, not a quote or offer. The rate slider range
 * (1.5%-5.7% per month) is illustrative, not a published iwoca rate band; iwoca's
 * representative example is ~3.33% per 30 days (~49% APR representative). Amount
 * bounds are calculator input guards, not iwoca lending limits.
 */

const AMOUNT_MIN = 1_000;
const AMOUNT_MAX = 1_000_000;
const RATE_MIN = 1.5;
const RATE_MAX = 5.7;
const RATE_DEFAULT = 3.3;
const TERMS = [12, 24, 48, 60] as const;
const TERM_DEFAULT = 24;
const DAYS_PER_MONTH = 30; // iwoca quotes interest "per 30 days"

const DISCLAIMER =
  "Illustrative estimate only — not a quote, an offer, or a financial promotion " +
  "from iwoca. Interest is calculated daily on the outstanding balance at (monthly " +
  "rate ÷ 30) per day. The term shows a standard schedule of equal monthly " +
  "repayments; because interest accrues daily, repaying early (no fees) means you " +
  "only pay interest up to the day you settle, saving the rest. The rate is one you " +
  "choose for illustration (iwoca's representative example is ~3.33% per 30 days, " +
  "~49% APR representative); actual rates and repayments depend on iwoca's assessment.";

export const loanCalculatorDefinition = {
  name: "loan_calculator",
  title: "Loan cost calculator",
  description:
    "Estimate what an iwoca loan could cost. Choose an amount, a monthly interest " +
    "rate (illustrative, 1.5%-5.7% per month), and a term (12, 24, 48 or 60 months) " +
    "to see the monthly repayment schedule. Interest is calculated daily, so if you " +
    "plan to repay early (no fees), pass repay_early with early_repayment_days to see " +
    "the lower cost and the interest saved. Returns an illustrative estimate plus a disclaimer.",
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
        description: `Loan amount in GBP (calculator range ${AMOUNT_MIN}-${AMOUNT_MAX}).`,
        minimum: AMOUNT_MIN,
        maximum: AMOUNT_MAX,
      },
      monthly_rate_pct: {
        type: "number",
        description: `Illustrative monthly interest rate, percent (${RATE_MIN}-${RATE_MAX}). Defaults to ${RATE_DEFAULT}.`,
        minimum: RATE_MIN,
        maximum: RATE_MAX,
      },
      term_months: {
        type: "integer",
        description: `Repayment term in months — one of ${TERMS.join(", ")}. Defaults to ${TERM_DEFAULT}.`,
        enum: [...TERMS],
      },
      repay_early: {
        type: "boolean",
        description:
          "Set true if the borrower plans to repay early (no fees). Requires early_repayment_days.",
      },
      early_repayment_days: {
        type: "integer",
        description:
          "If repaying early, the number of days until full repayment (e.g. 1 day, 21 for 3 weeks, 120 for 4 months).",
        minimum: 1,
      },
    },
  },
} as const;

const inputSchema = z
  .object({
    amount_gbp: z.number().min(AMOUNT_MIN).max(AMOUNT_MAX),
    monthly_rate_pct: z.number().min(RATE_MIN).max(RATE_MAX).default(RATE_DEFAULT),
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Equal monthly repayment for an amortising loan (annuity formula). */
function monthlyPayment(principal: number, monthlyRate: number, term: number): number {
  if (monthlyRate === 0) return principal / term;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -term));
}

/**
 * Cost of settling early after `days`. Simulates the amortising schedule for the
 * whole months elapsed, then accrues daily interest on the remaining balance for
 * the leftover days. Returns total interest actually paid and total repaid.
 */
function earlySettlement(
  principal: number,
  monthlyRate: number,
  payment: number,
  days: number,
) {
  const dailyRate = monthlyRate / DAYS_PER_MONTH;
  const fullMonths = Math.floor(days / DAYS_PER_MONTH);
  const remainderDays = days - fullMonths * DAYS_PER_MONTH;

  let balance = principal;
  let paid = 0;
  for (let m = 0; m < fullMonths && balance > 0; m++) {
    const interest = balance * monthlyRate;
    balance = balance + interest - payment;
    if (balance < 0) balance = 0;
    paid += payment;
  }
  const settlement = balance + balance * dailyRate * remainderDays;
  const totalRepaid = paid + settlement;
  const interestPaid = Math.max(0, totalRepaid - principal);
  return { totalRepaid, interestPaid };
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
        { type: "text" as const, text: `Input out of range or invalid: ${detail}` },
      ],
    };
  }

  const { amount_gbp, monthly_rate_pct, term_months, repay_early, early_repayment_days } =
    parsed.data;

  const i = monthly_rate_pct / 100;
  const dailyRate = i / DAYS_PER_MONTH;
  const payment = monthlyPayment(amount_gbp, i, term_months);
  const fullTotal = payment * term_months;
  const fullInterest = fullTotal - amount_gbp;

  const structuredContent: Record<string, unknown> = {
    amount_gbp,
    monthly_rate_pct,
    term_months,
    daily_interest_rate_pct: Math.round(dailyRate * 100 * 10000) / 10000, // percent
    full_term: {
      monthly_repayment_gbp: round2(payment),
      interest_gbp: round2(fullInterest),
      total_repayable_gbp: round2(fullTotal),
    },
    disclaimer: DISCLAIMER,
  };

  const lines = [
    `Illustrative cost for £${amount_gbp.toLocaleString("en-GB")} at ${monthly_rate_pct}%/month over ${term_months} months:`,
    `- Full term: £${round2(payment).toLocaleString("en-GB")}/month, interest £${round2(fullInterest).toLocaleString("en-GB")}, total repayable £${round2(fullTotal).toLocaleString("en-GB")}`,
  ];

  if (repay_early && early_repayment_days !== undefined) {
    const { totalRepaid, interestPaid } = earlySettlement(
      amount_gbp,
      i,
      payment,
      early_repayment_days,
    );
    const saving = fullInterest - interestPaid;
    structuredContent.early_repayment = {
      days: early_repayment_days,
      interest_gbp: round2(interestPaid),
      total_repayable_gbp: round2(totalRepaid),
      saving_vs_full_term_gbp: round2(saving),
    };
    lines.push(
      `- Repaid early after ${early_repayment_days} day(s): interest £${round2(interestPaid).toLocaleString("en-GB")}, total repayable £${round2(totalRepaid).toLocaleString("en-GB")} — saving £${round2(saving).toLocaleString("en-GB")} vs full term (no early-repayment fee)`,
    );
  }

  lines.push("", DISCLAIMER);

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent,
  };
}
