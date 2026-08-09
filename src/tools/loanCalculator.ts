import { z } from "zod";
import { loanCalculatorToolMeta } from "../appsSdk.js";

/**
 * Loan cost calculator.
 *
 * Method (illustrative, transparent):
 *  - The chosen term is a standard amortising schedule of equal monthly
 *    repayments (annuity formula at the monthly rate). Interest each month is
 *    charged on the OUTSTANDING balance, so as the balance falls the interest
 *    portion of each repayment gets a little smaller.
 *  - Repaying early settles the outstanding balance on the chosen day; interest is
 *    accrued daily up to that day only, so you save the remaining interest — no
 *    early-repayment fee.
 *  - Borrowing over 12 months may incur an additional fee: typically 5% of the
 *    amount for 13-24 months and 6% for longer (illustrative figures).
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
  "from iwoca. Interest is charged daily on the outstanding balance ((monthly rate " +
  "÷ 30) per day), so with equal monthly repayments the interest part of each " +
  "payment falls over time. Borrowing over 12 months may incur an additional fee " +
  "(typically 5% of the amount for 13-24 months, 6% for longer). Repaying early has " +
  "no fee — you only pay interest up to the day you settle. The rate is one you " +
  "choose for illustration (iwoca's representative example is ~3.33% per 30 days, " +
  "~49% APR representative); actual rates, fees and repayments depend on iwoca's assessment.";

export const loanCalculatorDefinition = {
  name: "loan_calculator",
  title: "Loan cost calculator",
  description:
    "Estimate what an iwoca loan could cost. Choose an amount, a monthly interest " +
    "rate (illustrative, 1.5%-5.7% per month), and a term (12, 24, 48 or 60 months) " +
    "to see the monthly repayment schedule. Interest is charged on the reducing " +
    "balance and borrowing over 12 months may add a fee. If you plan to repay early " +
    "(no fees), pass repay_early with early_repayment_days to see the lower cost and " +
    "the interest saved. Returns an illustrative estimate plus a disclaimer.",
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

/** Additional fee for borrowing over 12 months (illustrative, percent). */
function feePct(term: number): number {
  if (term <= 12) return 0;
  if (term <= 24) return 5;
  return 6;
}

/** Equal monthly repayment for an amortising loan (annuity formula). */
function monthlyPayment(principal: number, monthlyRate: number, term: number): number {
  if (monthlyRate === 0) return principal / term;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -term));
}

/** Interest charged in the first and final month (shows the declining trend). */
function firstAndFinalInterest(
  principal: number,
  monthlyRate: number,
  payment: number,
  term: number,
) {
  let balance = principal;
  let first = 0;
  let final = 0;
  for (let m = 0; m < term && balance > 0; m++) {
    const interest = balance * monthlyRate;
    if (m === 0) first = interest;
    final = interest;
    balance = balance + interest - payment;
    if (balance < 0) balance = 0;
  }
  return { first, final };
}

/**
 * Cost of settling early after `days`. Simulates the amortising schedule for the
 * whole months elapsed, then accrues daily interest on the remaining balance for
 * the leftover days. Returns total interest actually paid and amount repaid
 * (excluding any term fee).
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
  const fullInterest = payment * term_months - amount_gbp;
  const fee = amount_gbp * (feePct(term_months) / 100);
  const fullTotal = payment * term_months + fee;
  const { first, final } = firstAndFinalInterest(amount_gbp, i, payment, term_months);

  const structuredContent: Record<string, unknown> = {
    amount_gbp,
    monthly_rate_pct,
    term_months,
    daily_interest_rate_pct: Math.round(dailyRate * 100 * 10000) / 10000, // percent
    full_term: {
      monthly_repayment_gbp: round2(payment),
      interest_gbp: round2(fullInterest),
      first_month_interest_gbp: round2(first),
      final_month_interest_gbp: round2(final),
      fee_pct: feePct(term_months),
      fee_gbp: round2(fee),
      total_repayable_gbp: round2(fullTotal),
    },
    disclaimer: DISCLAIMER,
  };

  const feeNote = fee > 0 ? `, plus a ${feePct(term_months)}% fee (£${round2(fee).toLocaleString("en-GB")})` : "";
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
      `- Repaid early after ${early_repayment_days} day(s): interest £${round2(interestPaid).toLocaleString("en-GB")}${feeNote}, total repayable £${round2(earlyTotal).toLocaleString("en-GB")} — saving £${round2(saving).toLocaleString("en-GB")} of interest vs full term (no early-repayment fee)`,
    );
  }

  lines.push("", DISCLAIMER);

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent,
  };
}
