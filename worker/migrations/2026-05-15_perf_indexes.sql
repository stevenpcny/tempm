-- Performance migration: add indexes and denormalize domain on passwords
-- Run: wrangler d1 execute temp-mail-db --remote --file=./migrations/2026-05-15_perf_indexes.sql

-- P0: index for SSE tag-emails JOIN (passwords.label)
CREATE INDEX IF NOT EXISTS idx_passwords_label ON passwords(label);

-- P0: composite index for tag quota queries (confirmed + created_at)
CREATE INDEX IF NOT EXISTS idx_passwords_confirmed_created ON passwords(confirmed, created_at);

-- P1: denormalized domain column on passwords (replaces `address LIKE '%@xxx'` scans)
-- Note: SQLite has no `ADD COLUMN IF NOT EXISTS`. If re-running, this line will error;
-- comment it out on second apply.
ALTER TABLE passwords ADD COLUMN domain TEXT;

-- Backfill domain for existing rows
UPDATE passwords
SET domain = LOWER(SUBSTR(address, INSTR(address, '@') + 1))
WHERE domain IS NULL OR domain = '';

-- Index supporting per-domain daily/hourly quota queries
CREATE INDEX IF NOT EXISTS idx_passwords_domain_confirmed_created
  ON passwords(domain, confirmed, created_at);
