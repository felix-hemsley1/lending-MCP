import { z } from "zod";
import { creditCompassToolMeta } from "../appsSdk.js";
import {
  creditCompass,
  indicativeMonthlyRate,
  RATE_MIN,
  RATE_MAX,
  REP_RATE_PCT,
} from "../finance.js";

/**
 * iwoca Credit Compass — a DEMO / ILLUSTRATIVE view only. Surfaces in chat when
 * the user wants a feel for how their business might look and a rough idea of
 * rate. The score is deterministic illustrative logic (no real iwoca scoring or
 * data) and the derived rate is a rough estimate, never a guarantee.
 */

const DISCLAIMER =
  "DEMO / ILLUSTRATIVE ONLY — THIS IS FAKE DATA. The Credit Compass is not a " +
  "credit score, not a credit decision, and uses no real iwoca scoring or credit " +
  "data (a genuine version would need iwoca's scoring API, which is not connected). " +
  "The indicative interest rate is a ROUGH ESTIMATE, NOT A GUARANTEE and not " +
  `iwoca's real pricing — iwoca's representative rate is ${REP_RATE_PCT}% per month, and your ` +
  "actual rate is confirmed only after applying.";

export const creditCompassDefinition = {
  name: "credit_compass",
  title: "iwoca Credit Compass (demo estimate)",
  description:
    "Show the iwoca Credit Compass — a DEMO estimate of how a business might look, " +
    "using FAKE illustrative logic (no real iwoca data; a real version needs iwoca's " +
    "scoring API). Collect business details in conversation first (years trading, " +
    "monthly revenue, business name). If the user names a real company, call " +
    "lookup_company first and pass its public facts as companies_house — they are " +
    "echoed as inputs and add a factor, but the score STAYS the demo mock (public " +
    "register facts are not a credit score). Returns a score (35-90), band, factors, " +
    "and a ROUGH indicative monthly interest rate that is NOT a guarantee. If the " +
    "user then wants costs, surface loan_calculator with this rate. Always present " +
    "the output as a demo estimate, never a credit outcome or an offer.",
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
      companies_house: {
        type: "object",
        description:
          "Public register facts from lookup_company (echoed as inputs; not a credit score).",
        additionalProperties: false,
        properties: {
          company_name: { type: "string" },
          company_number: { type: "string" },
          company_status: { type: "string" },
          date_of_creation: { type: ["string", "null"] },
          accounts_overdue: { type: "boolean" },
        },
      },
    },
  },
} as const;

const chSchema = z
  .object({
    company_name: z.string().max(200).optional(),
    company_number: z.string().max(10).optional(),
    company_status: z.string().max(60).optional(),
    date_of_creation: z.string().max(20).nullable().optional(),
    accounts_overdue: z.boolean().optional(),
  })
  .optional();

const inputSchema = z.object({
  business_name: z.string().trim().min(1).max(200).optional(),
  sector: z.string().trim().min(1).max(100).optional(),
  years_trading: z.number().min(0).max(100).optional(),
  monthly_revenue_gbp: z.number().min(0).optional(),
  companies_house: chSchema,
});

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

  const { business_name, sector, years_trading, monthly_revenue_gbp, companies_house } =
    parsed.data;
  const estimate = creditCompass({ years_trading, monthly_revenue_gbp, companies_house });
  const rate = indicativeMonthlyRate(estimate.score);

  const structuredContent = {
    demo: true as const,
    data_source: "fake" as const,
    requires_api_connection: true as const,
    business_name: business_name ?? companies_house?.company_name ?? null,
    sector: sector ?? null,
    companies_house_inputs: companies_house ?? null,
    score: estimate.score,
    band: estimate.band,
    factors: estimate.factors,
    indicative_monthly_rate_pct: {
      low: rate.low,
      mid: rate.mid,
      high: rate.high,
      not_a_guarantee: true as const,
    },
    representative_rate_pct: REP_RATE_PCT,
    disclaimer: DISCLAIMER,
  };

  const text = [
    `iwoca Credit Compass (DEMO — FAKE DATA)${business_name ? ` for ${business_name}` : ""}`,
    `Illustrative score: ${estimate.score}/100 — band: ${estimate.band}`,
    ...estimate.factors.map((f) => `- ${f.name}: ${f.signal} — ${f.note}`),
    `Rough indicative rate: ~${rate.mid}%/month (range ${rate.low}-${rate.high}%, of a possible ${RATE_MIN}-${RATE_MAX}%) — NOT a guarantee. iwoca's representative rate is ${REP_RATE_PCT}%/month.`,
    `Next step if the user wants costs: call loan_calculator with monthly_rate_pct=${rate.mid}.`,
    ``,
    DISCLAIMER,
  ].join("\n");

  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}
