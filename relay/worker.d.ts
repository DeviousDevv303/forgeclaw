// Types for relay/worker.js (a plain-JS Cloudflare Worker), for its tests.
export function readZipEntries(buffer: ArrayBuffer, wanted: string[]): Promise<Record<string, string>>
declare const worker: { fetch(request: Request, env: Record<string, unknown>): Promise<Response> }
export default worker
