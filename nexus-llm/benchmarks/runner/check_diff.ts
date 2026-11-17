// Batch checkUnifiedDiff runner for run_gates.py.
// Reads a JSON file {id: patch} from argv[2] and prints one JSON line
// {id: errorStringOrNull} using the PINNED checkout's own instrument --
// the check is the repository's, never reimplemented.
// Run via: PIN_DIR=<pinned checkout> npx vite-node check_diff.ts <file>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pin = process.env.PIN_DIR;
if (!pin) throw new Error("PIN_DIR env required");
const { checkUnifiedDiff } = await import(join(pin, "src/lib/unifiedDiffCheck.ts"));

const patches = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out: Record<string, string | null> = {};
for (const [id, patch] of Object.entries(patches)) {
  out[id] = checkUnifiedDiff(patch as string);
}
console.log(JSON.stringify(out));
