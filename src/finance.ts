/**
 * Shared finance logic — single source of truth for the estimate + cost maths,
 * reused by the MCP tool and mirrored in the widget.
 *
 * Everything here is ILLUSTRATIVE. The Credit Compass score is a demo (no real
 * iwoca scoring/data); the derived interest rate is a rough, non-guaranteed
 * estimate, not iwoca's real pricing; the cost figures are estimates, not quotes.
 */

export const RATE_MIN = 1.5; // % per month (illustrative slider range)
export const RATE_MAX = 5.7;
/** iwoca's published representative rate, % per month (used in copy + defaults). */
export const REP_RATE_PCT = 3.3;
export const TERMS = [12, 24, 48, 60] as const;
export const DAYS_PER_MONTH = 30; // iwoca quotes interest "per 30 days"

export const SCORE_MIN = 35;
export const SCORE_MAX = 90;
const BASE_SCORE = 62;

export type Signal = "strong" | "steady" | "watch";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---- Credit Compass (demo) -------------------------------------------------

export interface CompassInputs {
  years_trading?: number;
  monthly_revenue_gbp?: number;
}

export interface CompassFactor {
  name: string;
  signal: Signal;
  note: string;
}

export function bandFor(score: number): string {
  if (score >= 80) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 50) return "Fair";
  return "Developing";
}

/** Deterministic illustrative score (NOT a real model). */
export function creditCompass(inputs: CompassInputs): {
  score: number;
  band: string;
  factors: CompassFactor[];
} {
  const { years_trading, monthly_revenue_gbp } = inputs;
  let score = BASE_SCORE;

  const tradingSignal: Signal =
    years_trading === undefined
      ? "steady"
      : years_trading >= 3
        ? "strong"
        : years_trading >= 1
          ? "steady"
          : "watch";
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

  score = clamp(Math.round(score), SCORE_MIN, SCORE_MAX);

  const factors: CompassFactor[] = [
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
      signal: "steady",
      note: "Illustrative repayment headroom indicator (demo).",
    },
  ];

  return { score, band: bandFor(score), factors };
}

/**
 * Map a demo score to a ROUGH indicative monthly interest-rate range. Higher
 * score → lower rate. This is NOT iwoca's pricing and NOT a guarantee.
 *
 * Piecewise-linear over calibration anchors: a typical business (base score,
 * no extra info) lands a little above the published representative rate
 * (3.3%/month), stronger businesses trend below it, weaker toward the top of
 * the illustrative range.
 */
const RATE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [SCORE_MIN, RATE_MAX], // 35 → 5.7
  [62, 3.9],
  [SCORE_MAX, 2.0], // 90 → 2.0
];

export function indicativeMonthlyRate(score: number): {
  low: number;
  mid: number;
  high: number;
} {
  const s = clamp(score, SCORE_MIN, SCORE_MAX);
  let mid = RATE_ANCHORS[RATE_ANCHORS.length - 1][1];
  for (let k = 0; k < RATE_ANCHORS.length - 1; k++) {
    const [s0, r0] = RATE_ANCHORS[k];
    const [s1, r1] = RATE_ANCHORS[k + 1];
    if (s <= s1) {
      mid = r0 + ((s - s0) / (s1 - s0)) * (r1 - r0);
      break;
    }
  }
  return {
    low: round2(clamp(mid - 0.4, RATE_MIN, RATE_MAX)),
    mid: round2(mid),
    high: round2(clamp(mid + 0.4, RATE_MIN, RATE_MAX)),
  };
}

// ---- Loan cost (amortising, daily interest) --------------------------------

/** Additional fee for borrowing over 12 months (illustrative, percent). */
export function feePct(term: number): number {
  if (term <= 12) return 0;
  if (term <= 24) return 5;
  return 6;
}

/** Equal monthly repayment for an amortising loan (annuity formula). */
export function monthlyPayment(principal: number, monthlyRate: number, term: number): number {
  if (monthlyRate === 0) return principal / term;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -term));
}

/** Interest charged in the first and final month (shows the declining trend). */
export function firstAndFinalInterest(
  principal: number,
  monthlyRate: number,
  payment: number,
  term: number,
): { first: number; final: number } {
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

/** Cost of settling early after `days` (excludes any term fee). */
export function earlySettlement(
  principal: number,
  monthlyRate: number,
  payment: number,
  days: number,
): { totalRepaid: number; interestPaid: number } {
  const dailyRate = monthlyRate / DAYS_PER_MONTH;
  const fullMonths = Math.floor(days / DAYS_PER_MONTH);
  const remainderDays = days - fullMonths * DAYS_PER_MONTH;
  let balance = principal;
  let paid = 0;
  for (let m = 0; m < fullMonths && balance > 0; m++) {
    balance = balance + balance * monthlyRate - payment;
    if (balance < 0) balance = 0;
    paid += payment;
  }
  const settlement = balance + balance * dailyRate * remainderDays;
  const totalRepaid = paid + settlement;
  return { totalRepaid, interestPaid: Math.max(0, totalRepaid - principal) };
}
