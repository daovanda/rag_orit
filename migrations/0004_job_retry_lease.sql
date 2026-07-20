ALTER TABLE jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE jobs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE jobs ADD COLUMN last_error_json TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_retry_lease
  ON jobs (status, lease_expires_at, attempt_count);

DROP INDEX IF EXISTS idx_operation_journal_attempt;
CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_journal_plan_attempt
  ON operation_journal (run_id, plan_id, operation_id, attempt);
