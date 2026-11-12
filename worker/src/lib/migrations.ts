/**
 * 迁移的唯一定义处：结构坍缩后的单一基线 `schema_v1`。
 *
 * - 全新库：`schema_v1` 的 sql 按 schema.ts 的定版 DDL 一次建出全部表/索引。
 * - 重复执行：全部 `CREATE … IF NOT EXISTS`，幂等空操作（账本已记账时直接 skipped）。
 * - 今后结构变化从 `schema_v2` 往后追加；`schema_v1` 不得改名、改内容或调序。
 *
 * 语句之间用 `;` 分隔，语句内部不得出现 `;`（含字符串字面量）。
 * 表名/索引名一律经 tables.ts / schema.ts 拼装，本文件只写 `{prefix}` 占位。
 */
import { SCHEMA_INDEXES, SCHEMA_TABLES, baselineStatements } from "./schema"
import { tableName } from "./tables"

/** 迁移执行时能拿到的东西：库与生效前缀。 */
export interface MigrationContext {
  db: D1Database
  prefix: string
}

export interface Migration {
  name: string
  sql: string
  /** 在 sql 之前执行的幂等补齐（存量升级用）；基线迁移不需要。 */
  prepare?: (ctx: MigrationContext) => Promise<void>
}

/** 唯一基线迁移名。追加迁移从 schema_v2 起，不改这一条。 */
export const BASELINE_MIGRATION = "schema_v1"

export function getMigrations(prefix: string): Migration[] {
  const statements = baselineStatements(prefix)
  const sql = statements.join(";\n\n")

  // 表名统一由 tables.ts 的 helper 提供；这里断言 schema.ts 与它用的是同一套名字
  // （改一处就会在这里暴露）。
  for (const table of SCHEMA_TABLES) {
    const expected = tableName(prefix, table.name)
    if (!sql.includes(expected)) {
      throw new Error(
        `migration ${BASELINE_MIGRATION} is missing table ${expected}`
      )
    }
  }
  for (const ddl of SCHEMA_INDEXES) {
    if (!ddl.includes("{prefix}")) {
      throw new Error("schema index DDL must use the {prefix} placeholder")
    }
  }

  return [{ name: BASELINE_MIGRATION, sql }]
}
