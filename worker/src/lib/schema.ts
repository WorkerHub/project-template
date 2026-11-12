/**
 * 基线表结构的唯一真源（规格 §5.2）。
 *
 * 同一份 DDL 有两个使用者：
 * - 唯一迁移 `schema_v1` 的建表语句（`migrations.ts`，表名带生效前缀）；
 * - `db/schema.sql`（人读的镜像，由本文件生成，测试断言逐字一致）。
 * 两处各写一份迟早漂移，所以这里只写一份。
 *
 * 约定：
 * - 每个 DDL 是一条完整语句，**内部不得出现 `;`**（含字符串字面量）——迁移执行器
 *   按 `;` 切分语句。表名用 `{table}` 占位，索引名/表名用 `{prefix}` 占位。
 * - 主键一律 `INTEGER PRIMARY KEY AUTOINCREMENT`：id 永不复用，删掉的用户不会被
 *   后来的新行「继承」掉旧的引用（created_by 等没有外键约束）。
 * - 只有业务无关的基础设施表：鉴权、验证码、设置、计数、迁移账本。
 *   不放任何示例业务表。
 */
import { tableName } from "./tables"

export interface SchemaTable {
  /** 逻辑表名（不含前缀）。 */
  name: string
  /** `CREATE TABLE` 语句，表名用 `{table}` 占位。 */
  ddl: string
}

/** 全部基线表（顺序即建表顺序；父子无外键、互不依赖）。 */
export const SCHEMA_TABLES: SchemaTable[] = [
  {
    name: "users",
    ddl: `CREATE TABLE IF NOT EXISTS {table} (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'user',
  status         TEXT NOT NULL DEFAULT 'pending',
  email_verified INTEGER NOT NULL DEFAULT 0,
  language       TEXT NOT NULL DEFAULT 'zh',
  display_name   TEXT NOT NULL DEFAULT '',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  theme          TEXT NOT NULL DEFAULT 'system',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
)`
  },
  {
    name: "user_2fa",
    ddl: `CREATE TABLE IF NOT EXISTS {table} (
  user_id       INTEGER PRIMARY KEY,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
)`
  },
  {
    name: "passkey_credentials",
    ddl: `CREATE TABLE IF NOT EXISTS {table} (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
)`
  },
  {
    name: "sessions",
    ddl: `CREATE TABLE IF NOT EXISTS {table} (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT ''
)`
  },
  {
    name: "email_verification_codes",
    ddl: `CREATE TABLE IF NOT EXISTS {table} (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register_verify', 'password_reset')),
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
)`
  },
  {
    name: "system_settings",
    ddl: `CREATE TABLE IF NOT EXISTS {table} (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`
  },
  {
    name: "auth_counters",
    ddl: `CREATE TABLE IF NOT EXISTS {table} (
  key          TEXT PRIMARY KEY,
  action       TEXT NOT NULL,
  account      TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT '',
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at   INTEGER NOT NULL
)`
  }
]

/** 取逻辑表的原始 DDL（表名占位 `{table}`）；迁移前要单独建表时也用它。 */
export function tableDdl(name: string): string {
  const table = SCHEMA_TABLES.find((candidate) => candidate.name === name)
  if (!table) throw new Error(`unknown table in schema: ${name}`)
  return table.ddl
}

/**
 * 计数表与它的索引：`core/counters.ts` 在迁移之前（setup 限流需要）用同一份 DDL
 * 幂等建表，所以这里单独导出，绝不另抄一份结构。
 */
export const AUTH_COUNTERS_TABLE_DDL = tableDdl("auth_counters")

export const AUTH_COUNTERS_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_{prefix}auth_counters_action_account
  ON {prefix}auth_counters(action, account)`

/** 全部索引（表名/索引名都用 `{prefix}` 占位，切换前缀后拼装）。 */
export const SCHEMA_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_{prefix}passkeys_user
  ON {prefix}passkey_credentials(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_{prefix}sessions_user
  ON {prefix}sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_{prefix}sessions_expires
  ON {prefix}sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_{prefix}email_codes_lookup
  ON {prefix}email_verification_codes(email, purpose, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_{prefix}email_codes_expires
  ON {prefix}email_verification_codes(expires_at)`,
  AUTH_COUNTERS_INDEX_DDL
]

/** 基线迁移的完整语句序列（表 + 索引），交给执行器逐条执行。 */
export function baselineStatements(prefix: string): string[] {
  const statements = SCHEMA_TABLES.map((table) =>
    table.ddl.replaceAll("{table}", tableName(prefix, table.name))
  )
  for (const ddl of SCHEMA_INDEXES) {
    statements.push(ddl.replaceAll("{prefix}", prefix))
  }
  return statements
}

const SCHEMA_SQL_NOTICE = `-- 本文件由 worker/src/lib/schema.ts 生成，请勿手改。
-- 重写命令：pnpm --filter ./worker schema:sql
-- 它是基线迁移 schema_v1 的逐字镜像，worker/test/schema-sql.test.ts 断言两者完全一致。
-- 语句之间用分号分隔，语句内部不得出现分号（迁移执行器按分号切分）。
-- 表名/索引名里的 {prefix} 是占位符，执行时替换成生效的 TABLE_PREFIX。`

/**
 * 渲染 `db/schema.sql` 的内容。传 `"{prefix}"` 得到占位形态（入库的那份）。
 */
export function renderSchemaSql(prefix: string): string {
  const body = baselineStatements(prefix)
    .map((statement) => `${statement};`)
    .join("\n\n")
  return `${SCHEMA_SQL_NOTICE}\n\n${body}\n`
}
