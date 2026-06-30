import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = resolve(process.env.IWOCA_DB_PATH ?? "data/iwoca.sqlite");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id                TEXT PRIMARY KEY,
    reference         TEXT UNIQUE,
    status            TEXT NOT NULL DEFAULT 'draft',
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL,
    company_name      TEXT NOT NULL,
    amount_requested  REAL NOT NULL,
    annual_turnover   REAL NOT NULL,
    use_of_funds      TEXT NOT NULL,
    funds_duration    TEXT NOT NULL,
    email             TEXT NOT NULL,
    phone             TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_applications_reference ON applications(reference);
`);

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "documents_requested";

export interface ApplicationRow {
  id: string;
  reference: string | null;
  status: ApplicationStatus;
  first_name: string;
  last_name: string;
  company_name: string;
  amount_requested: number;
  annual_turnover: number;
  use_of_funds: string;
  funds_duration: string;
  email: string;
  phone: string;
  created_at: string;
  updated_at: string;
}
