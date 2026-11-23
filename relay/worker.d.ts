// Types for relay/worker.js (a plain-JS Cloudflare Worker), for its tests.
export function readZipEntries(buffer: ArrayBuffer, wanted: string[]): Promise<Record<string, string>>
declare const worker: { fetch(request: Request, env: Record<string, unknown>): Promise<Response> }
export default worker
export function sanitizeErrorEntries(entries: unknown): Array<{ timestamp: number; level: string; source: string; message: string; details?: string }>
export function canonicalRecord(record: unknown): string
export function manipulationFlags(...texts: string[]): string[]
export interface SeatOrderEntry {
  tick: number | null
  operator: string
  orders: Array<{ verb: string; args: Record<string, unknown> }>
  directive?: string
  standing?: boolean
}
export function parseSeatOrderEntry(raw: unknown, index?: number): SeatOrderEntry
export function parseSeatOrdersFile(raw: unknown): { seat: string; entries: SeatOrderEntry[] }
export function canonicalSeatOrderJson(value: unknown): string
export function findSeatOrderDuplicate(file: { seat: string; entries: SeatOrderEntry[] }, entry: SeatOrderEntry): number
