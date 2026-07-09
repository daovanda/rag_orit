CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_per_conversation
  ON jobs (user_key, conversation_id)
  WHERE status IN ('queued', 'running');
