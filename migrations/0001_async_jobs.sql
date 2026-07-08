CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  userid TEXT NOT NULL,
  sitecode TEXT NOT NULL,
  roleid TEXT,
  orgid TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_owner_updated
  ON conversations (user_key, deleted_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('completed', 'generating', 'failed')),
  mode TEXT CHECK (mode IN ('default', 'search')),
  tools_called_json TEXT,
  sources_json TEXT,
  debug_steps_json TEXT,
  action_state_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations (conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, user_key, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_messages_owner_status
  ON messages (user_key, status, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  user_message_id TEXT,
  assistant_message_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'apply_pending_action')),
  mode TEXT NOT NULL CHECK (mode IN ('default', 'search')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_confirmation', 'succeeded', 'failed', 'cancelled', 'expired')),
  stage TEXT,
  progress_text TEXT,
  error TEXT,
  idempotency_key TEXT,
  auth_context_json TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations (conversation_id),
  FOREIGN KEY (user_message_id) REFERENCES messages (message_id),
  FOREIGN KEY (assistant_message_id) REFERENCES messages (message_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_owner_status
  ON jobs (user_key, conversation_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency
  ON jobs (user_key, conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_events (
  event_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs (job_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_events_job_seq
  ON job_events (job_id, seq);

CREATE INDEX IF NOT EXISTS idx_job_events_owner_job
  ON job_events (user_key, job_id, seq ASC);

CREATE TABLE IF NOT EXISTS pending_actions (
  action_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  job_id TEXT,
  assistant_message_id TEXT,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting_confirmation', 'confirmed', 'cancelled', 'applied', 'failed', 'expired')),
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations (conversation_id),
  FOREIGN KEY (job_id) REFERENCES jobs (job_id),
  FOREIGN KEY (assistant_message_id) REFERENCES messages (message_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_owner_status
  ON pending_actions (user_key, conversation_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_actions_plan
  ON pending_actions (user_key, plan_id, status);
