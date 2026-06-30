import { randomUUID } from "node:crypto";
import {
  db,
  type ApplicationRow,
  type ApplicationStatus,
} from "../database.js";
import type { DraftApplicationInput } from "../validation.js";

const REFERENCE_PREFIX = "IW-";
const REFERENCE_START = 100_001;

const STATUS_PROGRESSION: ApplicationStatus[] = [
  "submitted",
  "under_review",
  "documents_requested",
];

export interface ApplicationSummary {
  applicant: string;
  company_name: string;
  amount_requested_gbp: number;
  annual_turnover_gbp: number;
  use_of_funds: string;
  funds_duration: string;
  email: string;
  phone: string;
}

export interface DraftResult {
  draft_id: string;
  status: ApplicationStatus;
  summary: ApplicationSummary;
}

export interface SubmitResult {
  application_reference: string;
  status: ApplicationStatus;
  confirmation_message: string;
  secure_upload_url: string;
}

export interface StatusResult {
  application_reference: string;
  status: ApplicationStatus;
  status_label: string;
  next_step: string;
  summary: ApplicationSummary;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToSummary(row: ApplicationRow): ApplicationSummary {
  return {
    applicant: `${row.first_name} ${row.last_name}`,
    company_name: row.company_name,
    amount_requested_gbp: row.amount_requested,
    annual_turnover_gbp: row.annual_turnover,
    use_of_funds: row.use_of_funds,
    funds_duration: row.funds_duration,
    email: row.email,
    phone: row.phone,
  };
}

function statusLabel(status: ApplicationStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under Review";
    case "documents_requested":
      return "Documents Requested";
  }
}

function nextStep(status: ApplicationStatus, reference: string | null): string {
  switch (status) {
    case "draft":
      return "Call submit_application with the draft ID and confirmed=true to submit.";
    case "submitted":
      return "An iwoca specialist will pick up the application shortly.";
    case "under_review":
      return "Application is being reviewed; no action required from the applicant yet.";
    case "documents_requested":
      return reference
        ? `Upload supporting documents at https://demo.iwoca.app/upload/${reference}.`
        : "Upload supporting documents at the secure link provided after submission.";
  }
}

function generateReference(): string {
  const row = db
    .prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM applications WHERE reference IS NOT NULL",
    )
    .get();
  const next = REFERENCE_START + (row?.count ?? 0);
  return `${REFERENCE_PREFIX}${next}`;
}

export function createDraft(input: DraftApplicationInput): DraftResult {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO applications (
       id, status, first_name, last_name, company_name,
       amount_requested, annual_turnover, use_of_funds, funds_duration,
       email, phone, created_at, updated_at
     ) VALUES (
       @id, 'draft', @first_name, @last_name, @company_name,
       @amount_requested, @annual_turnover, @use_of_funds, @funds_duration,
       @email, @phone, @created_at, @updated_at
     )`,
  ).run({
    id,
    ...input,
    created_at: now,
    updated_at: now,
  });

  const row = db
    .prepare<[string], ApplicationRow>(
      "SELECT * FROM applications WHERE id = ?",
    )
    .get(id);
  if (!row) throw new Error("Draft was not persisted.");

  return {
    draft_id: id,
    status: row.status,
    summary: rowToSummary(row),
  };
}

export function submitDraft(draftId: string): SubmitResult {
  const row = db
    .prepare<[string], ApplicationRow>(
      "SELECT * FROM applications WHERE id = ?",
    )
    .get(draftId);

  if (!row) {
    throw new ServiceError(
      `No draft application was found for draft ID '${draftId}'.`,
    );
  }

  if (row.status !== "draft" && row.reference) {
    return {
      application_reference: row.reference,
      status: row.status,
      confirmation_message:
        "This application has already been submitted. Returning the existing reference.",
      secure_upload_url: `https://demo.iwoca.app/upload/${row.reference}`,
    };
  }

  const reference = generateReference();
  const now = nowIso();

  db.prepare(
    `UPDATE applications
       SET status = 'submitted',
           reference = ?,
           updated_at = ?
     WHERE id = ?`,
  ).run(reference, now, draftId);

  return {
    application_reference: reference,
    status: "submitted",
    confirmation_message: `Thanks ${row.first_name}, your iwoca application for ${row.company_name} has been received.`,
    secure_upload_url: `https://demo.iwoca.app/upload/${reference}`,
  };
}

export function getStatus(applicationReference: string): StatusResult {
  const row = db
    .prepare<[string], ApplicationRow>(
      "SELECT * FROM applications WHERE reference = ?",
    )
    .get(applicationReference);

  if (!row) {
    throw new ServiceError(
      `No application was found for reference '${applicationReference}'.`,
    );
  }

  const advanced = maybeAdvanceStatus(row);
  return {
    application_reference: advanced.reference!,
    status: advanced.status,
    status_label: statusLabel(advanced.status),
    next_step: nextStep(advanced.status, advanced.reference),
    summary: rowToSummary(advanced),
  };
}

function maybeAdvanceStatus(row: ApplicationRow): ApplicationRow {
  if (row.status === "draft" || row.status === "documents_requested") {
    return row;
  }
  const updatedAt = Date.parse(row.updated_at);
  if (Number.isNaN(updatedAt)) return row;

  const elapsedMs = Date.now() - updatedAt;
  const ADVANCE_AFTER_MS = 30_000;
  if (elapsedMs < ADVANCE_AFTER_MS) return row;

  const idx = STATUS_PROGRESSION.indexOf(row.status);
  if (idx < 0 || idx >= STATUS_PROGRESSION.length - 1) return row;

  const nextStatus = STATUS_PROGRESSION[idx + 1]!;
  const now = nowIso();
  db.prepare(
    "UPDATE applications SET status = ?, updated_at = ? WHERE id = ?",
  ).run(nextStatus, now, row.id);

  return { ...row, status: nextStatus, updated_at: now };
}

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}
