-- SQLite schema for ForgeMind engine local persistence
-- Phase 1: failure_ledger, task_history, integrity_catches, agent_contracts

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ── Enums as CHECK constraints ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'unknown' CHECK (intent IN ('autonomous', 'user_requested', 'system', 'unknown')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  payload TEXT, -- JSON stored as text
  result TEXT, -- JSON stored as text
  error_message TEXT,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_history_user_id ON task_history(user_id);
CREATE INDEX IF NOT EXISTS idx_task_history_status ON task_history(status);
CREATE INDEX IF NOT EXISTS idx_task_history_created_at ON task_history(created_at);

CREATE TABLE IF NOT EXISTS failure_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'unknown' CHECK (category IN ('api_error', 'timeout', 'auth_failure', 'config_error', 'upstream_error', 'integrity_violation', 'unknown')),
  task_id INTEGER,
  error_code TEXT,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  context TEXT, -- JSON stored as text
  resolved BOOLEAN DEFAULT FALSE,
  resolution_notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  FOREIGN KEY (task_id) REFERENCES task_history(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_failure_ledger_user_id ON failure_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_failure_ledger_category ON failure_ledger(category);
CREATE INDEX IF NOT EXISTS idx_failure_ledger_resolved ON failure_ledger(resolved);
CREATE INDEX IF NOT EXISTS idx_failure_ledger_created_at ON failure_ledger(created_at);

CREATE TABLE IF NOT EXISTS integrity_catches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  check_type TEXT NOT NULL,
  triggered BOOLEAN NOT NULL DEFAULT FALSE,
  details TEXT, -- JSON stored as text
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  acknowledged BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_integrity_catches_user_id ON integrity_catches(user_id);
CREATE INDEX IF NOT EXISTS idx_integrity_catches_triggered ON integrity_catches(triggered);
CREATE INDEX IF NOT EXISTS idx_integrity_catches_severity ON integrity_catches(severity);
CREATE INDEX IF NOT EXISTS idx_integrity_catches_created_at ON integrity_catches(created_at);
