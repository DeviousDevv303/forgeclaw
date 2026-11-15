import { getDb } from "./migrate.ts";

// ── Row types (match schema.sql exactly) ────────────────────────────

export interface FailureLedgerRow {
  id: number;
  user_id: string;
  category:
    | "api_error"
    | "timeout"
    | "auth_failure"
    | "config_error"
    | "upstream_error"
    | "integrity_violation"
    | "unknown";
  task_id: number | null;
  error_code: string | null;
  error_message: string;
  stack_trace: string | null;
  context: Record<string, unknown> | null;
  resolved: boolean;
  resolution_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface TaskHistoryRow {
  id: number;
  user_id: string;
  task_type: string;
  intent: "autonomous" | "user_requested" | "system" | "unknown";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface IntegrityCatchRow {
  id: number;
  user_id: string;
  check_type: string;
  triggered: boolean;
  details: Record<string, unknown> | null;
  severity: "info" | "warning" | "critical";
  acknowledged: boolean;
  created_at: string;
  acknowledged_at: string | null;
}

export interface AgentContractRow {
  id: number;
  agent_id: string;
  name: string;
  role: string;
  status: "active" | "paused" | "revoked";
  created_at: string;
  updated_at: string;
}

// ── Insert helpers (auto-inject user_id from caller) ───────────────

export function insertFailureLedger(
  row: Omit<FailureLedgerRow, "id" | "created_at" | "resolved_at">,
): number {
  const db = getDb();
  const result = db.query(
    `INSERT INTO failure_ledger (
      user_id, category, task_id, error_code, error_message,
      stack_trace, context, resolved, resolution_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id;`,
    [
      row.user_id,
      row.category,
      row.task_id ?? null,
      row.error_code ?? null,
      row.error_message,
      row.stack_trace ?? null,
      row.context ? JSON.stringify(row.context) : null,
      row.resolved ? 1 : 0,
      row.resolution_notes ?? null,
    ],
  );
  return result[0][0] as number;
}

export function insertTaskHistory(
  row: Omit<TaskHistoryRow, "id" | "created_at" | "started_at" | "completed_at">,
): number {
  const db = getDb();
  const result = db.query(
    `INSERT INTO task_history (
      user_id, task_type, intent, status, payload, result, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id;`,
    [
      row.user_id,
      row.task_type,
      row.intent,
      row.status,
      row.payload ? JSON.stringify(row.payload) : null,
      row.result ? JSON.stringify(row.result) : null,
      row.error_message ?? null,
    ],
  );
  return result[0][0] as number;
}

export function insertIntegrityCatch(
  row: Omit<IntegrityCatchRow, "id" | "created_at" | "acknowledged_at">,
): number {
  const db = getDb();
  const result = db.query(
    `INSERT INTO integrity_catches (
      user_id, check_type, triggered, details, severity, acknowledged
    ) VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id;`,
    [
      row.user_id,
      row.check_type,
      row.triggered ? 1 : 0,
      row.details ? JSON.stringify(row.details) : null,
      row.severity,
      row.acknowledged ? 1 : 0,
    ],
  );
  return result[0][0] as number;
}

export function insertAgentContract(
  row: Omit<AgentContractRow, "id" | "created_at" | "updated_at">,
): number {
  const db = getDb();
  const result = db.query(
    `INSERT INTO agent_contracts (agent_id, name, role, status)
     VALUES (?, ?, ?, ?)
     RETURNING id;`,
    [row.agent_id, row.name, row.role, row.status],
  );
  return result[0][0] as number;
}

// ── Query helpers ───────────────────────────────────────────────────

export function getFailureLedgerByUser(userId: string): FailureLedgerRow[] {
  const db = getDb();
  return db.query(
    `SELECT * FROM failure_ledger WHERE user_id = ? ORDER BY created_at DESC;`,
    [userId],
  ).map((row: unknown[]) => ({
    id: row[0] as number,
    user_id: row[1] as string,
    category: row[2] as FailureLedgerRow["category"],
    task_id: row[3] as number | null,
    error_code: row[4] as string | null,
    error_message: row[5] as string,
    stack_trace: row[6] as string | null,
    context: row[7] ? JSON.parse(row[7] as string) : null,
    resolved: (row[8] as number) === 1,
    resolution_notes: row[9] as string | null,
    created_at: row[10] as string,
    resolved_at: row[11] as string | null,
  }));
}

export function getTaskHistoryByUser(userId: string): TaskHistoryRow[] {
  const db = getDb();
  return db.query(
    `SELECT * FROM task_history WHERE user_id = ? ORDER BY created_at DESC;`,
    [userId],
  ).map((row: unknown[]) => ({
    id: row[0] as number,
    user_id: row[1] as string,
    task_type: row[2] as string,
    intent: row[3] as TaskHistoryRow["intent"],
    status: row[4] as TaskHistoryRow["status"],
    payload: row[5] ? JSON.parse(row[5] as string) : null,
    result: row[6] ? JSON.parse(row[6] as string) : null,
    error_message: row[7] as string | null,
    started_at: row[8] as string | null,
    completed_at: row[9] as string | null,
    created_at: row[10] as string,
  }));
}

export function getIntegrityCatchesByUser(userId: string): IntegrityCatchRow[] {
  const db = getDb();
  return db.query(
    `SELECT * FROM integrity_catches WHERE user_id = ? ORDER BY created_at DESC;`,
    [userId],
  ).map((row: unknown[]) => ({
    id: row[0] as number,
    user_id: row[1] as string,
    check_type: row[2] as string,
    triggered: (row[3] as number) === 1,
    details: row[4] ? JSON.parse(row[4] as string) : null,
    severity: row[5] as IntegrityCatchRow["severity"],
    acknowledged: (row[6] as number) === 1,
    created_at: row[7] as string,
    acknowledged_at: row[8] as string | null,
  }));
}

export function getAgentContracts(): AgentContractRow[] {
  const db = getDb();
  return db.query(
    `SELECT * FROM agent_contracts ORDER BY created_at DESC;`,
  ).map((row: unknown[]) => ({
    id: row[0] as number,
    agent_id: row[1] as string,
    name: row[2] as string,
    role: row[3] as string,
    status: row[4] as AgentContractRow["status"],
    created_at: row[5] as string,
    updated_at: row[6] as string,
  }));
}

// ── Update helpers ──────────────────────────────────────────────────

export function resolveFailureLedger(id: number, notes?: string): void {
  const db = getDb();
  db.query(
    `UPDATE failure_ledger SET resolved = 1, resolved_at = CURRENT_TIMESTAMP, resolution_notes = ? WHERE id = ?;`,
    [notes ?? null, id],
  );
}

export function acknowledgeIntegrityCatch(id: number): void {
  const db = getDb();
  db.query(
    `UPDATE integrity_catches SET acknowledged = 1, acknowledged_at = CURRENT_TIMESTAMP WHERE id = ?;`,
    [id],
  );
}

export function updateTaskStatus(
  id: number,
  status: TaskHistoryRow["status"],
  errorMessage?: string,
): void {
  const db = getDb();
  const isTerminal = status === "completed" || status === "failed" || status === "cancelled";
  db.query(
    `UPDATE task_history SET status = ?, ${isTerminal ? "completed_at" : "started_at"} = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?;`,
    [status, errorMessage ?? null, id],
  );
}
