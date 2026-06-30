import { z } from "zod";
import { submitApplicationSchema, formatZodError } from "../validation.js";
import { ServiceError, submitDraft } from "../services/applicationService.js";

export const submitApplicationDefinition = {
  name: "submit_application",
  title: "Submit a drafted iwoca application",
  description:
    "Submit a previously drafted iwoca application. Only call this after the user has reviewed " +
    "the summary returned by `draft_application` and explicitly confirmed they want to submit. " +
    "Returns a mock iwoca application reference and a secure upload URL to share with the user.",
  inputSchema: {
    type: "object",
    required: ["draft_id", "confirmed"],
    additionalProperties: false,
    properties: {
      draft_id: {
        type: "string",
        description: "Draft ID returned by `draft_application`.",
      },
      confirmed: {
        type: "boolean",
        const: true,
        description:
          "Must be true. Indicates the user has explicitly confirmed submission.",
      },
    },
  },
} as const;

export async function handleSubmitApplication(rawArgs: unknown) {
  const parsed = submitApplicationSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const result = submitDraft(parsed.data.draft_id);
    const text = [
      result.confirmation_message,
      ``,
      `Application reference: ${result.application_reference}`,
      `Status: ${result.status}`,
      `Secure upload link: ${result.secure_upload_url}`,
      ``,
      `Share the reference and the secure link with the user. They can check progress at any time by calling \`get_application_status\` with this reference.`,
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
    "Submission rejected. Fix the issues below and call `submit_application` again:",
    formatZodError(error),
  ].join("\n");
  return {
    isError: true,
    content: [{ type: "text" as const, text }],
  };
}
