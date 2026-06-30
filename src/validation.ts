import { z } from "zod";

const trimmedString = (label: string, max = 200) =>
  z
    .string({ required_error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

const phoneRegex = /^\+?[0-9 ()\-]{7,20}$/;

export const draftApplicationSchema = z.object({
  first_name: trimmedString("First name", 80),
  last_name: trimmedString("Last name", 80),
  company_name: trimmedString("Company name", 160),
  amount_requested: z
    .number({
      required_error: "Amount requested is required.",
      invalid_type_error: "Amount requested must be a number (in GBP).",
    })
    .positive("Amount requested must be greater than zero.")
    .max(1_000_000, "Amount requested cannot exceed £1,000,000."),
  annual_turnover: z
    .number({
      required_error: "Annual turnover is required.",
      invalid_type_error: "Annual turnover must be numeric (in GBP).",
    })
    .nonnegative("Annual turnover cannot be negative."),
  use_of_funds: trimmedString("Use of funds", 500),
  funds_duration: trimmedString("Funding duration", 80),
  email: z
    .string({ required_error: "Email is required." })
    .trim()
    .email("Email must be a valid email address."),
  phone: z
    .string({ required_error: "Phone number is required." })
    .trim()
    .regex(
      phoneRegex,
      "Phone number must contain 7-20 digits and may start with '+'.",
    ),
});

export type DraftApplicationInput = z.infer<typeof draftApplicationSchema>;

export const submitApplicationSchema = z.object({
  draft_id: trimmedString("Draft ID", 64),
  confirmed: z.literal(true, {
    errorMap: () => ({
      message: "`confirmed` must be true to submit the application.",
    }),
  }),
});

export const getApplicationStatusSchema = z.object({
  application_reference: trimmedString("Application reference", 32),
});

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "input";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
}
