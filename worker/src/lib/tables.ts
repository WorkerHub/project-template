/**
 * 所有表名/索引名的唯一拼装点（规格 §5.1：表名一律经 TABLE_PREFIX helper，
 * 不得写死最终表名）。前缀来自 src/lib/table-prefix.ts 的 getTablePrefix()。
 *
 * 除本文件外，其它模块不得用 `${prefix}users` 这类字面量拼表名。
 */

/** 把逻辑表名拼成当前部署下的实际表名。 */
export function tableName(prefix: string, name: string): string {
  return `${prefix}${name}`
}

/** 把逻辑索引名拼成当前部署下的实际索引名。 */
export function indexName(prefix: string, name: string): string {
  return `idx_${prefix}${name}`
}

export const usersTable = (prefix: string) => tableName(prefix, "users")
export const user2faTable = (prefix: string) => tableName(prefix, "user_2fa")
export const passkeysTable = (prefix: string) =>
  tableName(prefix, "passkey_credentials")
export const sessionsTable = (prefix: string) => tableName(prefix, "sessions")
export const emailCodesTable = (prefix: string) =>
  tableName(prefix, "email_verification_codes")
export const settingsTable = (prefix: string) =>
  tableName(prefix, "system_settings")
/**
 * 限流与连续失败锁定的计数表（规格 §5.2 表清单内的基础设施表，经裁决增列）。
 * setup 限流在迁移之前就要生效，因此 `core/counters.ts` 会用 schema.ts 的同一份
 * DDL 先把它建出来。
 */
export const countersTable = (prefix: string) =>
  tableName(prefix, "auth_counters")

/**
 * 迁移账本（规格 §5.1）：表名带前导下划线、排在业务表之前——
 * `_template_schema_migrations`、无前缀时 `_schema_migrations`。换前缀即换一套账本。
 */
export const migrationsTable = (prefix: string) =>
  `_${tableName(prefix, "schema_migrations")}`

/**
 * 旧版迁移账本名（无前导下划线，如 `template_schema_migrations`）。
 * 只供 setup 的一次性改名承接使用，业务代码不得再往这张表读写信账。
 */
export const legacyMigrationsTable = (prefix: string) =>
  tableName(prefix, "schema_migrations")
