import { z } from "zod";
import { draftApplicationSchema, formatZodError } from "../validation.js";
import { createDraft } from "../services/applicationService.js";

export const draftApplicationDefinition = {
  name: "draft_application",
  title: "Draft an iwoca business finance application",
  description:
    "Capture the applicant's details and create a draft iwoca business finance application. " +
    "Call this once you have collected every required field from the user. The tool returns " +
    "a draft ID and a human-readable summary that should be read back to the user for confirmation " +
    "before calling `submit_application`.",
  inputSchema: {
    type: "object",
    required: [
      "first_name",
      "last_name",
      "company_name",
      "amount_requested",
      "annual_turnover",
      "use_of_funds",
      "funds_duration",
      "email",
      "phone",
    ],
    additionalProperties: false,
    properties: {
      first_name: { type: "string", description: "Applicant's first name." },
      last_name: { type: "string", description: "Applicant's last name." },
      company_name: {
        type: "string",
        description: "Registered or trading name of the business.",
      },
      amount_requested: {
        type: "number",
        description:
          "Amount of funding requested in GBP. Must be > 0 and ≤ 1,000,000.",
        exclusiveMinimum: 0,
        maximum: 1_000_000,
      },
      annual_turnover: {
        type: "number",
        description: "Most recent full-year turnover of the business in GBP.",
        minimum: 0,
      },
      use_of_funds: {
        type: "string",
        description:
          "Short free-text description of what the funds will be used for.",
      },
      funds_duration: {
        type: "string",
        description:
          "How long the funds are needed for (e.g. '6 months', '2 years').",
      },
      email: {
        type: "string",
        description: "Applicant's email address.",
        format: "email",
      },
      phone: {
        type: "string",
        description: "Applicant's contact phone number (7-20 digits, may start with '+').",
      },
    },
  },
} as const;

export async function handleDraftApplication(rawArgs: unknown) {
  const parsed = draftApplicationSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const result = createDraft(parsed.data);
  const text = [
    `Draft application created.`,
    ``,
    `Draft ID: ${result.draft_id}`,
    `Status: draft`,
    ``,
    `Summary:`,
    `- Applicant: ${result.summary.applicant}`,
    `- Company: ${result.summary.company_name}`,
    `- Amount requested: £${result.summary.amount_requested_gbp.toLocaleString("en-GB")}`,
    `- Annual turnover: £${result.summary.annual_turnover_gbp.toLocaleString("en-GB")}`,
    `- Use of funds: ${result.summary.use_of_funds}`,
    `- Funding duration: ${result.summary.funds_duration}`,
    `- Email: ${result.summary.email}`,
    `- Phone: ${result.summary.phone}`,
    ``,
    `Next step: read this summary back to the user, ask them to confirm, then call \`submit_application\` with this draft ID and \`confirmed: true\`.`,
  ].join("\n");

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: result,
  };
}

function validationFailure(error: z.ZodError) {
  const text = [
    "Validation failed. Please ask the user for the missing or invalid fields, then call `draft_application` again:",
    formatZodError(error),
  ].join("\n");
  return {
    isError: true,
    content: [{ type: "text" as const, text }],
  };
}
