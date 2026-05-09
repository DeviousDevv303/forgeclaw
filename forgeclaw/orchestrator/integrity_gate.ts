// forgeclaw/orchestrator/integrity_gate.ts
//
// Integrity enforcement layer — truth-consistency kernel.
// Spec: original handoff packet + Addenda 1–3
// Standing principle: Functional Replay (MEMORY.md, 2026-05-09)

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

export const DEFAULT_CONFIG: GateConfig = {
  session_history_dir: "forgeclaw/logs/sessions",
  neutral_corpus_path: null,
  ledger_path: "forgeclaw/logs/integrity_failures.jsonl",
};

const DENIAL_PATTERNS: RegExp[] = [
  /\bi\s+(?:do\s+not|don['']?t)\s+know\b/i,
  /\bi\s+(?:can\s+not|can['']?t)\s+(?:find|locate)\b/i,
  /\bi\s+(?:do\s+not|don['']?t)\s+have\b/i,
  /\bno\s+record\s+of\b/i,
  /\bwouldn['']?t\s+tell\s+you\b/i,
  /\bi\s+(?:have\s+not|haven['']?t)\s+(?:seen|heard|found|located)\b/i,
  /\bthat['']?s\s+not\s+(?:something|information)\s+i\s+(?:have|know)\b/i,
];

function hasDenialPattern(output: string): boolean {
  return DENIAL_PATTERNS.some((p) => p.test(output));
}

export async function verify_unknown(
  query: string,
  config: GateConfig = DEFAULT_CONFIG,
): Promise<VerifyUnknownResult> {
  const needle = query.toLowerCase().trim();
  if (needle.length === 0) {
    return { found: false, source: null, evidence: null };
  }

  const sessionHit = await searchDirectoryJsonl(needle, config.session_history_dir);
  if (sessionHit) return sessionHit;

  if (config.neutral_corpus_path) {
    const corpusHit = await searchSingleJsonl(needle, config.neutral_corpus_path);
    if (corpusHit) return corpusHit;
  }

  return { found: false, source: null, evidence: null };
}

async function searchDirectoryJsonl(
  needle: string,
  dir: string,
): Promise<VerifyUnknownResult | null> {
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
      const hit = await searchSingleJsonl(needle, `${dir}/${entry.name}`);
      if (hit) return hit;
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  return null;
}

async function searchSingleJsonl(
  needle: string,
  path: string,
): Promise<VerifyUnknownResult | null> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const haystack = line.toLowerCase();
    if (!haystack.includes(needle)) continue;

    let evidence: string;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === "string") {
        evidence = parsed;
      } else if (parsed && typeof parsed === "object") {
        const candidates = [
          parsed.content,
          parsed.text,
          parsed.message,
          parsed.response,
          parsed.output,
          parsed.evidence,
        ];
        const match = candidates.find(
          (c) => typeof c === "string" && c.toLowerCase().includes(needle),
        );
        evidence = match ?? JSON.stringify(parsed);
      } else {
        evidence = String(parsed);
      }
    } catch {
      evidence = line;
    }

    return { found: true, source: path, evidence };
  }

  return null;
}

export async function ledger_append(
  event: FailureEvent,
  config: GateConfig = DEFAULT_CONFIG,
): Promise<void> {
  const record = JSON.stringify(event) + "\n";

  const slash = config.ledger_path.lastIndexOf("/");
  if (slash > 0) {
    const parent = config.ledger_path.slice(0, slash);
    try {
      await Deno.mkdir(parent, { recursive: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
    }
  }

  await Deno.writeTextFile(config.ledger_path, record, { append: true });
}

export async function denial_filter(
  candidate_output: string,
  context: DenialFilterContext,
  config: GateConfig = DEFAULT_CONFIG,
): Promise<DenialFilterResult> {
  const isDenial = hasDenialPattern(candidate_output);
  const override = context.user_message.includes("#override");

  if (override) {
    const event: FailureEvent = {
      timestamp: new Date().toISOString(),
      agent: context.agent,
      event_type: "USER_OVERRIDE",
      claim: candidate_output,
      actual: null,
      root_cause: "OVERRIDE_INVOKED",
      override: true,
      session_id: context.session_id,
      turn_id: context.turn_id,
    };
    await ledger_append(event, config);
    return { allowed: true, violation: event };
  }

  if (!isDenial) {
    return { allowed: true };
  }

  if (!context.verify_unknown_called) {
    const event: FailureEvent = {
      timestamp: new Date().toISOString(),
      agent: context.agent,
      event_type: "DENIAL_WITHOUT_VERIFICATION",
      claim: candidate_output,
      actual: null,
      root_cause: "NO_MEMORY_CHECK",
      override: false,
      session_id: context.session_id,
      turn_id: context.turn_id,
    };
    await ledger_append(event, config);
    return {
      allowed: false,
      reason: "Denial without prior verify_unknown call",
      violation: event,
    };
  }

  if (context.verify_unknown_result?.found === true) {
    const event: FailureEvent = {
      timestamp: new Date().toISOString(),
      agent: context.agent,
      event_type: "VERIFICATION_CONTRADICTION",
      claim: candidate_output,
      actual: context.verify_unknown_result.evidence,
      root_cause: "KNOWN_DATA_DENIED",
      override: false,
      session_id: context.session_id,
      turn_id: context.turn_id,
    };
    await ledger_append(event, config);
    return {
      allowed: false,
      reason: "Denial contradicts verified evidence",
      violation: event,
    };
  }

  return { allowed: true };
}