/**
 * 规格 §7-3：防静默切换——库里已在另一个前缀下初始化过时，setup 必须中止报错，
 * 绝不在新前缀下另建一套空表；当前前缀被别人的同名 users 表占用时同样拦住。
 *
 * 前缀一律从默认常量推出，不写死部署前缀（生成新项目后改默认前缀即自动跟随）。
 */
import { describe, expect, it } from "vitest"
import { DEFAULT_TABLE_PREFIX, PROJECT_SLUG } from "../src/config/project"
import { tableDdl } from "../src/lib/schema"
import { runSetup } from "../src/lib/setup"
import { sessionsTable, settingsTable, usersTable } from "../src/lib/tables"
import { activePrefix, makeContext, tableNames } from "./support/app"

const DEFAULT_PREFIX = `${DEFAULT_TABLE_PREFIX}_`

describe("防静默切换", () => {
  it("已在别的前缀初始化过 + 前缀未配置 → PREFIX_CONFLICT，不建新表", async () => {
    const context = makeContext({ TABLE_PREFIX: "fleet" })
    const first = await runSetup(context.env)
    expect(first.success).toBe(true)
    expect(activePrefix(context.env)).toBe("fleet_")

    const before = tableNames(context.db)
    // 同一个库、换一份 env（前缀回到默认值）：模拟"漏配了 TABLE_PREFIX"。
    const misconfigured = { ...context.env, TABLE_PREFIX: undefined }
    const result = await runSetup(misconfigured)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe("PREFIX_CONFLICT")
      expect(result.resolvedPrefix).toBe(DEFAULT_PREFIX)
      expect(result.detectedPrefixes).toEqual(["fleet_"])
      // 可读 detail：说清检测到什么、该怎么处理，写明项目 slug、旧前缀与当前前缀。
      expect(result.error).toContain("fleet_")
      expect(result.error).toContain("TABLE_PREFIX")
      expect(result.error).toContain(PROJECT_SLUG)
      expect(result.error).toContain(DEFAULT_PREFIX)
    }
    // 一个表都不多、不少。
    expect(tableNames(context.db)).toEqual(before)
    expect(tableNames(context.db)).not.toContain(usersTable(DEFAULT_PREFIX))
  })

  it("外来三件套 slug 不同（共享库兄弟项目）→ setup 成功", async () => {
    const { env, db } = makeContext()
    const brotherPrefix = "brother_"

    // 模拟库中已存在兄弟项目的三件套（users + settings + sessions）
    db.db.exec(
      `CREATE TABLE ${usersTable(brotherPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${sessionsTable(brotherPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${settingsTable(brotherPrefix)} (key TEXT PRIMARY KEY, value TEXT);
       INSERT INTO ${settingsTable(brotherPrefix)} (key, value) VALUES ('project_slug', 'brother_app');`
    )

    const result = await runSetup(env)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.tablePrefix).toBe(DEFAULT_PREFIX)
    }
    // 本项目表成功建出，兄弟项目表完好
    const tables = tableNames(db)
    expect(tables).toContain(usersTable(DEFAULT_PREFIX))
    expect(tables).toContain(usersTable(brotherPrefix))
  })

  it("外来三件套无 slug 行（存量旧项目形态）→ setup 成功", async () => {
    const { env, db } = makeContext()
    const legacyPrefix = "legacy_"

    // 模拟历史存量三件套，settings 表中未记录 project_slug
    db.db.exec(
      `CREATE TABLE ${usersTable(legacyPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${sessionsTable(legacyPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${settingsTable(legacyPrefix)} (key TEXT PRIMARY KEY, value TEXT);
       INSERT INTO ${settingsTable(legacyPrefix)} (key, value) VALUES ('setup_page_enabled', '0');`
    )

    const result = await runSetup(env)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.tablePrefix).toBe(DEFAULT_PREFIX)
    }
    expect(tableNames(db)).toContain(usersTable(DEFAULT_PREFIX))
    expect(tableNames(db)).toContain(usersTable(legacyPrefix))
  })

  it("外来三件套 slug 相同、前缀不同 → 409", async () => {
    const { env, db } = makeContext()
    const foreignPrefix = "oldproj_"

    // 模拟同一 slug 在旧前缀下初始化过
    db.db.exec(
      `CREATE TABLE ${usersTable(foreignPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${sessionsTable(foreignPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${settingsTable(foreignPrefix)} (key TEXT PRIMARY KEY, value TEXT);
       INSERT INTO ${settingsTable(foreignPrefix)} (key, value) VALUES ('project_slug', '${PROJECT_SLUG}');`
    )

    const result = await runSetup(env)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe("PREFIX_CONFLICT")
      expect(result.resolvedPrefix).toBe(DEFAULT_PREFIX)
      expect(result.detectedPrefixes).toEqual([foreignPrefix])
      expect(result.error).toContain(PROJECT_SLUG)
      expect(result.error).toContain(foreignPrefix)
      expect(result.error).toContain(DEFAULT_PREFIX)
    }
  })

  it("库中同时存在兄弟项目与同 slug 旧前缀 → 仅拦截同 slug 旧前缀", async () => {
    const { env, db } = makeContext()
    const brotherPrefix = "brother_"
    const oldPrefix = "oldproj_"

    // 兄弟项目
    db.db.exec(
      `CREATE TABLE ${usersTable(brotherPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${sessionsTable(brotherPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${settingsTable(brotherPrefix)} (key TEXT PRIMARY KEY, value TEXT);
       INSERT INTO ${settingsTable(brotherPrefix)} (key, value) VALUES ('project_slug', 'other_project');`
    )
    // 同 slug 旧前缀
    db.db.exec(
      `CREATE TABLE ${usersTable(oldPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${sessionsTable(oldPrefix)} (id TEXT PRIMARY KEY);
       CREATE TABLE ${settingsTable(oldPrefix)} (key TEXT PRIMARY KEY, value TEXT);
       INSERT INTO ${settingsTable(oldPrefix)} (key, value) VALUES ('project_slug', '${PROJECT_SLUG}');`
    )

    const result = await runSetup(env)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe("PREFIX_CONFLICT")
      expect(result.detectedPrefixes).toEqual([oldPrefix])
      expect(result.detectedPrefixes).not.toContain(brotherPrefix)
    }
  })

  it("同一前缀重复 setup 不误报冲突", async () => {
    const context = makeContext({ TABLE_PREFIX: "fleet" })
    expect((await runSetup(context.env)).success).toBe(true)
    const again = await runSetup(context.env)
    expect(again.success).toBe(true)
  })

  it("当前前缀下已有别人的 users 表 → table-collision，不静默复用", async () => {
    const { env, db } = makeContext()
    db.db.exec(
      `CREATE TABLE ${usersTable(DEFAULT_PREFIX)} (id TEXT PRIMARY KEY)`
    )

    const result = await runSetup(env)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe("PREFIX_CONFLICT")
      expect(result.error).toContain("collision")
      expect(result.detectedPrefixes).toEqual([DEFAULT_PREFIX])
    }
    // 只保留了那张别人的表：没有顺手建出本项目其它表。
    expect(tableNames(db)).toEqual([usersTable(DEFAULT_PREFIX)])
  })

  it("本项目半成品（users 三列俱在）→ 按续跑修复，不误报", async () => {
    const { env, db } = makeContext()
    db.db.exec(
      tableDdl("users").replaceAll("{table}", usersTable(DEFAULT_PREFIX))
    )

    const result = await runSetup(env)
    expect(result.success).toBe(true)
    expect(tableNames(db)).toContain(usersTable(DEFAULT_PREFIX))
  })
})
