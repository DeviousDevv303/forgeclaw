// The only entry point that produces an exam report: it checks the pack pin first and scores nothing if the check fails.
// CLI: run-cli.ts.
import { scoreExam, type ExamOptions, type ExamReport, type Trial } from './harness'
import { BUCKET_EDGES_ID, ESTIMATOR_ID, PACK_ID, PACK_PATH, PACK_SHA256, REGISTRY_ID, checkPackFile } from './pin'

export interface PinnedReport { pack: { id: string; sha256: string; estimator: string; bucketEdges: string; registry: string }; report: ExamReport }
export type PinnedResult = { ok: true; result: PinnedReport } | { ok: false; reason: string }

export function runPinnedExam(trials: Trial[], opts: ExamOptions & { packPath?: string; expectedSha256?: string } = {}): PinnedResult {
  const pin = checkPackFile(opts.packPath ?? PACK_PATH, opts.expectedSha256 ?? PACK_SHA256)
  if (!pin.ok) return { ok: false, reason: `refusing to score: ${pin.reason}` }
  return { ok: true, result: { pack: { id: PACK_ID, sha256: pin.sha256, estimator: ESTIMATOR_ID, bucketEdges: BUCKET_EDGES_ID, registry: REGISTRY_ID }, report: scoreExam(trials, opts) } }
}
