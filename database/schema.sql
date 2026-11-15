-- ForgeClaw Phase 1 Schema
-- Supabase backend layer for agent contracts, task history, failure ledger, integrity catches
-- Apply with: supabase db reset (local) or supabase link + supabase db push (prod)

-- ─── Extensions ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Enums ───────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'failure_category') THEN
    CREATE TYPE failure_category AS ENUM (
      'DENIAL_WITHOUT_VERIFICATION',
      'VERIFICATION_CONTRADICTION',
      'USER_OVERRIDE',
      'API_FAILURE',
      'ORCHESTRATOR_REJECTION',
      'BUILD_FAILURE',
      'TYPE_VIOLATION',
      'SCOPE_VIOLATION',
      'OTHER'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_intent') THEN
    CREATE TYPE task_intent AS ENUM ('chat', 'commit', 'build', 'deploy', 'review', 'research', 'other');
  END IF;
END $$;

-- ─── System-global table: agent_contracts ─────────────────────────────────────
-- Authenticated read for all signed-in users; service_role write only

CREATE TABLE IF NOT EXISTS agent_contracts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id text NOT NULL UNIQUE,
  role text NOT NULL,
  version text NOT NULL,
  content text NOT NULL,
  ratified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE agent_contracts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_contracts' AND policyname = 'agent_contracts_authenticated_read'
  ) THEN
    CREATE POLICY agent_contracts_authenticated_read ON agent_contracts
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- service_role has full access by default (bypass RLS)

-- ─── User-scoped table: task_history ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  agent_id text NOT NULL,
  intent task_intent DEFAULT 'other',
  status task_status DEFAULT 'pending',
  payload jsonb DEFAULT '{}',
  result jsonb DEFAULT null,
  error text DEFAULT null,
  timeout_ms integer DEFAULT 30000,
  scopes text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  resolved_at timestamptz DEFAULT null
);

ALTER TABLE task_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_history' AND policyname = 'task_history_user_select'
  ) THEN
    CREATE POLICY task_history_user_select ON task_history
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_history' AND policyname = 'task_history_user_insert'
  ) THEN
    CREATE POLICY task_history_user_insert ON task_history
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_history' AND policyname = 'task_history_user_update'
  ) THEN
    CREATE POLICY task_history_user_update ON task_history
      FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─── User-scoped table: failure_ledger ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS failure_ledger (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent text NOT NULL,
  event_type text NOT NULL,
  category failure_category DEFAULT 'OTHER',
  claim text DEFAULT null,
  actual text DEFAULT null,
  root_cause text NOT NULL,
  override boolean DEFAULT false,
  session_id text DEFAULT null,
  turn_id text DEFAULT null,
  context jsonb DEFAULT null,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE failure_ledger ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'failure_ledger' AND policyname = 'failure_ledger_user_select'
  ) THEN
    CREATE POLICY failure_ledger_user_select ON failure_ledger
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'failure_ledger' AND policyname = 'failure_ledger_user_insert'
  ) THEN
    CREATE POLICY failure_ledger_user_insert ON failure_ledger
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─── User-scoped table: integrity_catches ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS integrity_catches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  check_type text NOT NULL,
  triggered boolean NOT NULL,
  details jsonb DEFAULT null,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE integrity_catches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integrity_catches' AND policyname = 'integrity_catches_user_select'
  ) THEN
    CREATE POLICY integrity_catches_user_select ON integrity_catches
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integrity_catches' AND policyname = 'integrity_catches_user_insert'
  ) THEN
    CREATE POLICY integrity_catches_user_insert ON integrity_catches
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─── Indexes on hot paths ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_task_history_user_id ON task_history(user_id);
CREATE INDEX IF NOT EXISTS idx_task_history_status ON task_history(status);
CREATE INDEX IF NOT EXISTS idx_task_history_created_at ON task_history(created_at);

CREATE INDEX IF NOT EXISTS idx_failure_ledger_user_id ON failure_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_failure_ledger_agent ON failure_ledger(agent);
CREATE INDEX IF NOT EXISTS idx_failure_ledger_created_at ON failure_ledger(created_at);

CREATE INDEX IF NOT EXISTS idx_integrity_catches_user_id ON integrity_catches(user_id);
CREATE INDEX IF NOT EXISTS idx_integrity_catches_created_at ON integrity_catches(created_at);

-- ─── Updated-at trigger helper ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_agent_contracts_updated_at'
  ) THEN
    CREATE TRIGGER update_agent_contracts_updated_at
      BEFORE UPDATE ON agent_contracts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_task_history_updated_at'
  ) THEN
    CREATE TRIGGER update_task_history_updated_at
      BEFORE UPDATE ON task_history
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
