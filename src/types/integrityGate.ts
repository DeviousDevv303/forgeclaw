// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
export interface FailureEvent {
  timestamp: string;
  agent: string;
  event_type:
    | "DENIAL_WITHOUT_VERIFICATION"
    | "USER_OVERRIDE"
    | "VERIFICATION_CONTRADICTION";
  claim: string;
  actual: string | null;
  root_cause:
    | "NO_MEMORY_CHECK"
    | "SAFETY_PATTERN_MISFIRE"
    | "KNOWN_DATA_DENIED"
    | "OVERRIDE_INVOKED";
  override: boolean;
  session_id: string;
  turn_id: string;
}

export interface VerifyUnknownResult {
  found: boolean;
  source: string | null;
  evidence: string | null;
}

export interface DenialFilterContext {
  verify_unknown_called: boolean;
  verify_unknown_result: VerifyUnknownResult | null;
  session_id: string;
  turn_id: string;
  agent: string;
  user_message: string;
}

export interface DenialFilterResult {
  allowed: boolean;
  reason?: string;
  violation?: FailureEvent;
}

export interface GateConfig {
  session_history_dir: string;
  neutral_corpus_path: string | null;
  ledger_path: string;
}
