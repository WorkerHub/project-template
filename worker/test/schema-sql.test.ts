/**
 * 规格 §7-4：worker/src/db/schema.sql 与内嵌定义（schema.ts）逐字一致性。
 * 不一致即失败——两处各写一份 DDL 迟早漂移，这条测试就是防漂移的锁。
 *
 * 重写文件：pnpm --filter ./worker schema:sql（本用例在 SCHEMA_SQL_UPDATE=1 时写入）。
 */
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { renderSchemaSql } from "../src/lib/schema"

const schemaFile = path.resolve(import.meta.dirname, "../src/db/schema.sql")

test("schema.sql 与 schema.ts 的基线定义逐字一致", () => {
  const expected = renderSchemaSql("{prefix}")

  if (process.env.SCHEMA_SQL_UPDATE === "1") {
    writeFileSync(schemaFile, expected)
  }

  expect(readFileSync(schemaFile, "utf8")).toBe(expected)
})

test("schema.sql 里的语句用分号分隔、表名带 {prefix} 占位", () => {
  const content = readFileSync(schemaFile, "utf8")
  const statements = content
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
  expect(statements).toContain("CREATE TABLE IF NOT EXISTS {prefix}users")
  expect(statements).toContain(
    "CREATE TABLE IF NOT EXISTS {prefix}system_settings"
  )
  expect(statements).toContain(
    "CREATE TABLE IF NOT EXISTS {prefix}auth_counters"
  )
  expect(statements).not.toContain("CREATE TABLE IF NOT EXISTS users")
})
