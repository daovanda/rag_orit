CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  job_id TEXT,
  conversation_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'running', 'waiting_confirmation', 'repairing', 'succeeded',
    'failed', 'blocked', 'verification_failed'
  )),
  goal TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs (job_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations (conversation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_job
  ON agent_runs (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_status
  ON agent_runs (user_key, conversation_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS operation_journal (
  journal_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  job_id TEXT,
  plan_id TEXT,
  operation_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'running', 'succeeded', 'failed', 'skipped',
    'verification_failed', 'compensated'
  )),
  attempt INTEGER NOT NULL DEFAULT 1,
  precondition_json TEXT,
  expected_effect_json TEXT,
  request_json TEXT,
  result_json TEXT,
  error_json TEXT,
  postcondition_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs (run_id),
  FOREIGN KEY (job_id) REFERENCES jobs (job_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_journal_attempt
  ON operation_journal (run_id, operation_id, attempt);

CREATE INDEX IF NOT EXISTS idx_operation_journal_run_status
  ON operation_journal (run_id, status, updated_at ASC);

CREATE TABLE IF NOT EXISTS agent_phase_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'running', 'succeeded', 'failed', 'verification_failed'
  )),
  state_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs (run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_phase_checkpoint
  ON agent_phase_checkpoints (run_id, phase);
