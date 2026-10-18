/**
 * An in-memory stand-in for the Worker's D1 binding (env.DB), backed by Node's own SQLite
 * (node:sqlite, Node 22.13+), so the tests run the real migration and the real SQL of
 * deploy/intake-worker/src/d1store.mjs without Cloudflare or wrangler. Only the parts of the D1
 * client API the store uses: prepare().bind().run()/all()/first(), batch(), exec().
 *
 * Faults: set `state.fail` to an Error (or a function (sql) => Error | null) and every statement
 * throws it, the way D1 surfaces "D1_ERROR: no such table: attempts".
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
export const MIGRATIONS_DIR = path.join(ROOT, "deploy", "intake-worker", "migrations")

/** Every migrations/*.sql in name order, the way wrangler applies them. */
export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
}

function meta(info = {}) {
  return { duration: 0, changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0), rows_read: 0, rows_written: Number(info.changes ?? 0) }
}

export function fakeD1({ migrate = true } = {}) {
  const db = new DatabaseSync(":memory:")
  const state = { fail: null, statements: 0, batches: 0 }
  if (migrate) for (const file of migrationFiles()) db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))

  function maybeFail(sql) {
    const fault = typeof state.fail === "function" ? state.fail(sql) : state.fail
    if (fault) throw fault
  }

  function statement(sql, params = []) {
    const values = params.map((value) => (value === undefined ? null : value))
    const prepared = () => db.prepare(sql)
    return {
      sql,
      params: values,
      bind: (...next) => statement(sql, next),
      async run() {
        state.statements += 1
        maybeFail(sql)
        return execute()
      },
      async all() {
        state.statements += 1
        maybeFail(sql)
        return execute()
      },
      async first(column) {
        state.statements += 1
        maybeFail(sql)
        const row = prepared().get(...values)
        if (row === undefined) return null
        const plain = { ...row }
        return column === undefined ? plain : (plain[column] ?? null)
      },
      async raw() {
        state.statements += 1
        maybeFail(sql)
        return prepared().all(...values).map((row) => Object.values(row))
      },
      /** Synchronous core shared by run()/all()/batch(): statements that return rows give results, others meta. */
      execute: () => execute(),
    }
    function execute() {
      const stmt = prepared()
      if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        const rows = stmt.all(...values).map((row) => ({ ...row }))
        return { success: true, results: rows, meta: meta({ changes: /^\s*SELECT/i.test(sql) ? 0 : rows.length }) }
      }
      const info = stmt.run(...values)
      return { success: true, results: [], meta: meta(info) }
    }
  }

  return {
    db,
    state,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      state.batches += 1
      state.statements += statements.length
      for (const item of statements) maybeFail(item.sql)
      db.exec("BEGIN")
      try {
        const results = statements.map((item) => item.execute())
        db.exec("COMMIT")
        return results
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    async exec(sql) {
      state.statements += 1
      maybeFail(sql)
      db.exec(sql)
      return { count: 1, duration: 0 }
    },
    /** Test conveniences, not part of D1. */
    rows: () => db.prepare("SELECT * FROM attempts ORDER BY id").all().map((row) => ({ ...row })),
    count: () => Number(db.prepare("SELECT COUNT(*) AS n FROM attempts").get().n),
    close: () => db.close(),
  }
}
