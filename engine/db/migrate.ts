import { DB } from "https://deno.land/x/sqlite/mod.ts";

const DB_PATH = Deno.env.get("FORGEMIND_DB_PATH") ?? "./engine/db/forgemind.db";

let db: DB | null = null;

export function getDb(): DB {
  if (!db) {
    db = new DB(DB_PATH);
    // Enable foreign keys and WAL mode for better concurrency
    db.execute("PRAGMA foreign_keys = ON;");
    db.execute("PRAGMA journal_mode = WAL;");
  }
  return db;
}

export async function migrate(): Promise<void> {
  const database = getDb();
  const schema = await Deno.readTextFile(
    new URL("./schema.sql", import.meta.url),
  );

  // Split by statement and execute each
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    // Skip PRAGMA statements — they error if run inside a transaction
    if (stmt.toUpperCase().includes("PRAGMA")) {
      try {
        database.execute(stmt + ";");
      } catch (_e) {
        // PRAGMAs are idempotent — safe to ignore errors
      }
      continue;
    }
    database.execute(stmt + ";");
  }

  console.log("[migrate] SQLite schema applied successfully.");
}

export async function closeDb(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}
