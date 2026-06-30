import { z } from "zod";
import {
  formatZodError,
  getApplicationStatusSchema,
} from "../validation.js";
import { ServiceError, getStatus } from "../services/applicationService.js";

export const getApplicationStatusDefinition = {
  name: "get_application_status",
  title: "Check the status of an iwoca application",
  description:
    "Look up the current status of a submitted iwoca application using its reference (e.g. 'IW-100001'). " +
    "Returns the current stage and a suggested next step to share with the user. " +
    "For the demo, status progresses automatically over time: Submitted → Under Review → Documents Requested.",
  inputSchema: {
    type: "object",
    required: ["application_reference"],
    additionalProperties: false,
    properties: {
      application_reference: {
        type: "string",
        description:
          "Application reference returned by `submit_application` (e.g. 'IW-100001').",
      },
    },
  },
} as const;

export async function handleGetApplicationStatus(rawArgs: unknown) {
  const parsed = getApplicationStatusSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const result = getStatus(parsed.data.application_reference);
    const text = [
      `Application ${result.application_reference} for ${result.summary.company_name}:`,
      `- Status: ${result.status_label}`,
      `- Amount requested: £${result.summary.amount_requested_gbp.toLocaleString("en-GB")}`,
      `- Use of funds: ${result.summary.use_of_funds}`,
      ``,
      `Next step: ${result.next_step}`,
    ].join("\n");

    return {
      content: [{ type: "text" as const, text }],
      structuredContent: result,
    };
  } catch (err) {
    if (err instanceof ServiceError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: err.message }],
      };
    }
    throw err;
  }
}

function validationFailure(error: z.ZodError) {
  const text = [
    "Status lookup rejected. Fix the issues below and call `get_application_status` again:",
    formatZodError(error),
  ].join("\n");
  return {
    isError: true,
    content: [{ type: "text" as const, text }],
  };
}
