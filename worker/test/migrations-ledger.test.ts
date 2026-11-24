/**
 * 规格 §7-2：迁移账本命名（带前导下划线）、旧账本改名承接与单一 V1 生产只读兼容。
 * 顺带锁住硬约束：基线语句内部不得出现 `;`、表名一律由 tables.ts 拼装。
 */
import { describe, expect, it } from "vitest"
import {
  BASELINE_MIGRATION,
  SCHEMA_V2_MIGRATION,
  getMigrations
} from "../src/lib/migrations"
import { splitStatements } from "../src/lib/migrations-runner"
import { ledgerName, runSetup } from "../src/lib/setup"
import {
  emailCodesTable,
  legacyMigrationsTable,
  migrationsTable,
  sessionsTable,
  settingsTable,
  user2faTable,
  usersTable
} from "../src/lib/tables"
import {
  activePrefix,
  initializedContext,
  makeContext,
  tableNames
} from "./support/app"
import type { SqliteD1 } from "./support/sqlite-d1"

/** 表当前的列名（按表定义顺序）。 */
function columnNames(db: SqliteD1, table: string): string[] {
  return db.db
    .prepare(`PRAGMA table_info(${table})`)
    .all<{ name: string }>()
    .map((column) => column.name)
}

describe("迁移定义", () => {
  it("基线 schema_v1 与增量 schema_v2，语句内部不含分号", () => {
    const prefix = "wiki_"
    const migrations = getMigrations(prefix)
    expect(migrations.map((migration) => migration.name)).toEqual([
      BASELINE_MIGRATION,
      SCHEMA_V2_MIGRATION
    ])
    const baselineStatements = splitStatements(migrations[0].sql)
    expect(baselineStatements.length).toBeGreaterThan(0)
    for (const migration of migrations) {
      const statements = splitStatements(migration.sql)
      for (const statement of statements) {
        expect(statement).not.toContain(";")
      }
    }
    // 基线迁移建表与索引
    for (const statement of baselineStatements) {
      expect(statement.startsWith("CREATE")).toBe(true)
    }
  })

  it("表名一律带生效前缀（没有任何无前缀表名）", () => {
    const prefix = "wiki_"
    const [migration] = getMigrations(prefix)
    for (const statement of splitStatements(migration.sql)) {
      const tableMatch = statement.match(/CREATE TABLE IF NOT EXISTS (\S+)/)
      if (tableMatch) {
        expect(tableMatch[1].startsWith(prefix)).toBe(true)
      }
    }
  })

  it("无前缀时表名就是逻辑名", () => {
    const sql = getMigrations("")[0].sql
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS users")
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS system_settings")
    expect(sql).not.toContain("CREATE TABLE IF NOT EXISTS _")
  })
})

describe("账本命名", () => {
  it("带前缀：账本带前导下划线，旧版无下划线的名字不会被建出来", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    expect(ledgerName(prefix)).toBe(`_${prefix}schema_migrations`)
    expect(ledgerName(prefix)).toBe(migrationsTable(prefix))

    const tables = tableNames(db)
    expect(tables).toContain(migrationsTable(prefix))
    expect(tables).not.toContain(legacyMigrationsTable(prefix))
  })

  it("无前缀：账本名是 _schema_migrations", async () => {
    const { db } = await initializedContext({ TABLE_PREFIX: "" })
    expect(ledgerName("")).toBe("_schema_migrations")
    expect(tableNames(db)).toContain("_schema_migrations")
  })

  it("重复 setup 只做幂等检查：全部 skipped", async () => {
    const { env } = await initializedContext()
    const again = await runSetup(env)
    expect(again.success).toBe(true)
    if (again.success) {
      expect(again.migrations).toEqual([
        { name: BASELINE_MIGRATION, status: "skipped" },
        { name: "schema_v2", status: "skipped" }
      ])
    }
  })
})

describe("旧账本改名承接", () => {
  it("旧账本在、新账本不在 → 改名承接，已应用记录保留，迁移全部 skipped", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const legacy = legacyMigrationsTable(prefix)

    // 模拟旧版账本形态：把新账本改名回旧名字。
    db.db.exec(`ALTER TABLE ${migrationsTable(prefix)} RENAME TO ${legacy}`)
    expect(tableNames(db)).toContain(legacy)
    expect(tableNames(db)).not.toContain(migrationsTable(prefix))

    const result = await runSetup(env)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.migrations).toEqual([
        { name: BASELINE_MIGRATION, status: "skipped" },
        { name: "schema_v2", status: "skipped" }
      ])
    }

    const tables = tableNames(db)
    expect(tables).toContain(migrationsTable(prefix))
    expect(tables).not.toContain(legacy)

    const rows = db.db
      .prepare(`SELECT name FROM ${migrationsTable(prefix)}`)
      .all() as Array<{ name: string }>
    expect(rows.map((row) => row.name)).toEqual([
      BASELINE_MIGRATION,
      "schema_v2"
    ])
  })

  it("新旧账本同存 → 409 LEDGER_CONFLICT，一个表都不动", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    db.db.exec(
      `CREATE TABLE ${legacyMigrationsTable(prefix)} (name TEXT PRIMARY KEY)`
    )
    const before = tableNames(db)

    const result = await runSetup(env)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe("LEDGER_CONFLICT")
      expect(result.error).toContain(legacyMigrationsTable(prefix))
    }
    expect(tableNames(db)).toEqual(before)
    expect(tableNames(db)).toContain(legacyMigrationsTable(prefix))
  })

  it("旧账本没有 name 列（别人的表）→ 409，绝不改名", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const legacy = legacyMigrationsTable(prefix)
    db.db.exec(`ALTER TABLE ${migrationsTable(prefix)} RENAME TO ${legacy}`)
    db.db.exec(`ALTER TABLE ${legacy} RENAME TO ${legacy}_old`)
    db.db.exec(`CREATE TABLE ${legacy} (id TEXT PRIMARY KEY)`)

    const result = await runSetup(env)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe("LEDGER_CONFLICT")
    }
    expect(
      db.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
        )
        .get(legacy)
    ).toBeTruthy()
    expect(tableNames(db)).not.toContain(migrationsTable(prefix))
    expect(tableNames(db)).toContain(usersTable(prefix))
    expect(tableNames(db)).toContain(settingsTable(prefix))
    expect(tableNames(db)).toContain(sessionsTable(prefix))
  })
})

describe("存量库存量兼容与升级（历史已应用 schema_v1）", () => {
  it("存量库已有 schema_v1 记录：执行 setup 触发 schema_v2 applied、新列补齐、账本新增 v2 一条且既有账号完整保留", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const ledger = migrationsTable(prefix)
    const users = usersTable(prefix)
    const passkeys = `${prefix}passkey_credentials`
    const user2fa = `${prefix}user_2fa`
    const now = new Date().toISOString()

    // 模拟存量库状态：账本拥有 schema_v1 应用记录，表尚未添加 name 和 totp_label
    db.db.exec(`DELETE FROM ${ledger}`)
    db.db
      .prepare(`INSERT INTO ${ledger} (name, applied_at) VALUES (?, ?)`)
      .run(BASELINE_MIGRATION, Math.floor(Date.now() / 1000))

    // 存量既有测试账号
    db.db
      .prepare(
        `INSERT INTO ${users}
          (email, password_hash, role, status, email_verified, language,
           display_name, timezone, created_at, updated_at, must_change_password)
         VALUES (?, 'hash', 'admin', 'active', 1, 'zh', 'ProdAdmin', 'Asia/Shanghai', ?, ?, 0)`
      )
      .run("prod-admin@example.test", now, now)

    // 执行 setup / 数据库增量升级
    const result = await runSetup(env)
    expect(result.success).toBe(true)
    if (result.success) {
      // 基线 V1 命中已有记录 skipped；增量 V2 执行 applied
      expect(result.migrations).toEqual([
        { name: BASELINE_MIGRATION, status: "skipped" },
        { name: "schema_v2", status: "applied" }
      ])
    }

    // 账本在原 1 条基础上新增 schema_v2 一条（共 2 条）
    const afterLedgerRows = db.db
      .prepare(
        `SELECT name, applied_at FROM ${ledger} ORDER BY applied_at, name`
      )
      .all() as Array<{ name: string; applied_at: number }>
    expect(afterLedgerRows).toHaveLength(2)
    expect(afterLedgerRows.map((row) => row.name)).toEqual([
      BASELINE_MIGRATION,
      "schema_v2"
    ])

    // 新列补齐
    expect(columnNames(db, passkeys)).toContain("name")
    expect(columnNames(db, user2fa)).toContain("totp_label")

    // 既有测试账号完整保留
    const userRow = db.db
      .prepare(
        `SELECT email, display_name, role, status FROM ${users} WHERE email = ?`
      )
      .get("prod-admin@example.test")
    expect(userRow).toEqual({
      email: "prod-admin@example.test",
      display_name: "ProdAdmin",
      role: "admin",
      status: "active"
    })

    // 再次执行 setup，全部 skipped 幂等
    const repeat = await runSetup(env)
    expect(repeat.success).toBe(true)
    if (repeat.success) {
      expect(repeat.migrations).toEqual([
        { name: BASELINE_MIGRATION, status: "skipped" },
        { name: "schema_v2", status: "skipped" }
      ])
    }
  })
})

describe("单一 V1 终态表结构验证（全新安装）", () => {
  it("users 表：无 username、无 theme、有 must_change_password", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const columns = columnNames(db, usersTable(prefix))
    expect(columns).not.toContain("username")
    expect(columns).not.toContain("theme")
    expect(columns).toContain("must_change_password")
  })

  it("user_2fa 表：有 email_2fa_enabled", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const columns = columnNames(db, user2faTable(prefix))
    expect(columns).toContain("email_2fa_enabled")
    expect(columns).toContain("totp_label")
  })

  it("passkey_credentials 表：有 name 列", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const columns = columnNames(db, `${prefix}passkey_credentials`)
    expect(columns).toContain("name")
  })

  it("email_verification_codes 表：CHECK 约束支持三值", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const codes = emailCodesTable(prefix)
    const now = Math.floor(Date.now() / 1000)

    // 三个目的均能成功插入
    for (const purpose of ["register_verify", "password_reset", "email_2fa"]) {
      db.db
        .prepare(
          `INSERT INTO ${codes} (email, purpose, code_hash, expires_at, created_at)
           VALUES (?, ?, 'hash', ?, ?)`
        )
        .run(`test-${purpose}@example.test`, purpose, now + 600, now)
    }

    // 非法目的触发 CHECK 失败
    expect(() =>
      db.db
        .prepare(
          `INSERT INTO ${codes} (email, purpose, code_hash, expires_at, created_at)
           VALUES ('bad@example.test', 'invalid_purpose', 'hash', ?, ?)`
        )
        .run(now + 600, now)
    ).toThrow(/CHECK/i)
  })
})

describe("增量迁移 schema_v2 幂等补齐存量库", () => {
  it("存量库已有 schema_v1（无新列）时，执行 setup 触发 schema_v2 增量补齐，两路终态一致", async () => {
    const { env, db } = makeContext()
    const prefix = activePrefix(env)
    const passkeys = `${prefix}passkey_credentials`
    const user2fa = `${prefix}user_2fa`
    const ledger = migrationsTable(prefix)

    // 模拟旧库结构：按老结构建表并记账 schema_v1
    db.db.exec(
      `CREATE TABLE ${ledger} (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()));
       INSERT INTO ${ledger} (name) VALUES ('schema_v1');
       CREATE TABLE ${settingsTable(prefix)} (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
       CREATE TABLE ${sessionsTable(prefix)} (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '');
       CREATE TABLE ${usersTable(prefix)} (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'pending', email_verified INTEGER NOT NULL DEFAULT 0, language TEXT NOT NULL DEFAULT 'zh', display_name TEXT NOT NULL DEFAULT '', timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE ${user2fa} (user_id INTEGER PRIMARY KEY, totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, email_2fa_enabled INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE ${passkeys} (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, credential_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_used_at TEXT);`
    )

    // 升级前确认无新列
    expect(columnNames(db, passkeys)).not.toContain("name")
    expect(columnNames(db, user2fa)).not.toContain("totp_label")

    // 执行 setup 升级
    const result = await runSetup(env)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.migrations).toEqual([
        { name: "schema_v1", status: "skipped" },
        { name: "schema_v2", status: "applied" }
      ])
    }

    // 升级后新列补齐，终态与全新库一致
    expect(columnNames(db, passkeys)).toContain("name")
    expect(columnNames(db, user2fa)).toContain("totp_label")

    // 再次执行 setup，全部 skipped 幂等
    const repeat = await runSetup(env)
    expect(repeat.success).toBe(true)
    if (repeat.success) {
      expect(repeat.migrations).toEqual([
        { name: "schema_v1", status: "skipped" },
        { name: "schema_v2", status: "skipped" }
      ])
    }
  })
})
