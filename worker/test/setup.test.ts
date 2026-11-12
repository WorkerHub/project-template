/**
 * 规格 §7-5：setup 契约逐条。
 *
 * - state 形状与 no-store、未初始化恒开
 * - 密钥只认请求头（URL 带密钥被拒）、错钥 403、未配置/占位符 500
 * - 按 IP 限流 3 次/10 分钟，第 4 次 429（计数在 D1，跨重启不丢）
 * - 前缀冲突 409 可读 detail 且不建表
 * - 管理面与会密钥面回显同形；管理面 401/403 双层
 * - 初始化完成显式写关 setup_page_enabled=0，且不覆盖已有值
 */
import { describe, expect, it } from "vitest"
import { DEFAULT_TABLE_PREFIX } from "../src/config/project"
import { getTablePrefix } from "../src/lib/table-prefix"
import { ledgerName } from "../src/lib/setup"
import {
  countersTable,
  legacyMigrationsTable,
  sessionsTable,
  settingsTable,
  usersTable
} from "../src/lib/tables"
import {
  TEST_SETUP_SECRET,
  activePrefix,
  clearCounters,
  initializedContext,
  makeContext,
  readSetting,
  request,
  seedSession,
  tableNames
} from "./support/app"

const SECRET_HEADER = { "x-setup-secret": TEST_SETUP_SECRET }
const DEFAULT_PREFIX = `${DEFAULT_TABLE_PREFIX}_`

function postSetup(
  env: Parameters<typeof request>[0],
  headers: Record<string, string> = {}
) {
  return request(env, "/api/setup", { method: "POST", headers })
}

describe("setup：初始化与回显", () => {
  it("正确密钥建表并回显 {success, tablePrefix, migrations}", async () => {
    const { env, db } = makeContext()
    const prefix = activePrefix(env)

    const res = await postSetup(env, SECRET_HEADER)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      tablePrefix: prefix,
      migrations: [{ name: "schema_v1", status: "applied" }]
    })

    const tables = tableNames(db)
    for (const table of [
      usersTable(prefix),
      `${prefix}user_2fa`,
      `${prefix}passkey_credentials`,
      sessionsTable(prefix),
      `${prefix}email_verification_codes`,
      settingsTable(prefix),
      countersTable(prefix),
      ledgerName(prefix)
    ]) {
      expect(tables).toContain(table)
    }
    // 旧版账本名不得被建出来。
    expect(tables).not.toContain(legacyMigrationsTable(prefix))
    // 纯升级端点：不建用户。
    const users = db.db
      .prepare(`SELECT COUNT(*) AS n FROM ${usersTable(prefix)}`)
      .get() as { n: number }
    expect(users.n).toBe(0)
  })

  it("初始化完成显式写关 setup_page_enabled=0", async () => {
    const { env, db } = makeContext()
    await postSetup(env, SECRET_HEADER)
    expect(readSetting(db, activePrefix(env), "setup_page_enabled")).toBe("0")
  })

  it("重复 setup：全部 skipped，且不覆盖已有设置", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    db.db
      .prepare(
        `UPDATE ${settingsTable(prefix)} SET value = '1' WHERE key = 'setup_page_enabled'`
      )
      .run()
    clearCounters(db, prefix)

    const res = await postSetup(env, SECRET_HEADER)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      migrations: Array<{ name: string; status: string }>
    }
    expect(body.migrations).toEqual([{ name: "schema_v1", status: "skipped" }])
    expect(readSetting(db, prefix, "setup_page_enabled")).toBe("1")
  })

  it("setup 开关只门控页面：页面关闭后密钥接口仍可用", async () => {
    const { env, db } = await initializedContext()
    expect(readSetting(db, activePrefix(env), "setup_page_enabled")).toBe("0")
    clearCounters(db, activePrefix(env))
    const res = await postSetup(env, SECRET_HEADER)
    expect(res.status).toBe(200)
  })
})

describe("setup/state", () => {
  it("未初始化：enabled 恒开、ownerExists=false、回显生效前缀、no-store", async () => {
    const { env } = makeContext()
    const res = await request(env, "/api/setup/state")
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({
      enabled: true,
      ownerExists: false,
      tablePrefix: DEFAULT_PREFIX
    })
  })

  it("已初始化：页面关闭、无所有者", async () => {
    const { env } = await initializedContext()
    const res = await request(env, "/api/setup/state")
    expect(await res.json()).toEqual({
      enabled: false,
      ownerExists: false,
      tablePrefix: activePrefix(env)
    })
  })

  it("有已批准管理员 → ownerExists=true；待批准管理员不算", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    await seedSession(db, prefix, {
      role: "admin",
      status: "pending",
      email: "pending-admin@example.test"
    })
    let body = (await (await request(env, "/api/setup/state")).json()) as {
      ownerExists: boolean
    }
    expect(body.ownerExists).toBe(false)

    await seedSession(db, prefix, {
      role: "admin",
      status: "active",
      email: "owner@example.test"
    })
    body = (await (await request(env, "/api/setup/state")).json()) as {
      ownerExists: boolean
    }
    expect(body.ownerExists).toBe(true)
  })

  it("无前缀部署：tablePrefix 回空串", async () => {
    const { env } = await initializedContext({ TABLE_PREFIX: "" })
    const body = (await (await request(env, "/api/setup/state")).json()) as {
      tablePrefix: string
    }
    expect(body.tablePrefix).toBe("")
  })

  it("state 不含密钥/哈希字段", async () => {
    const { env } = await initializedContext()
    const raw = await (await request(env, "/api/setup/state")).text()
    expect(raw).not.toContain("secret")
    expect(raw).not.toContain("hash")
  })
})

describe("setup：密钥卫生", () => {
  it("错钥 403，只在库里留下限流计数表（猜密钥的尝试也要计数）", async () => {
    const { env, db } = makeContext()
    const res = await postSetup(env, { "x-setup-secret": "wrong" })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "Invalid setup secret" })
    expect(tableNames(db)).toEqual([countersTable(getTablePrefix(env))])
  })

  it("GET /api/setup?secret=… → 405 且 Allow: POST", async () => {
    const { env } = makeContext()
    const res = await request(env, `/api/setup?secret=${TEST_SETUP_SECRET}`)
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })

  it("POST 只在 URL 带密钥 → 403（只认请求头）", async () => {
    const { env } = makeContext()
    const res = await postSetup(env, {})
    expect(res.status).toBe(403)

    const withQuery = await request(
      env,
      `/api/setup?secret=${TEST_SETUP_SECRET}`,
      { method: "POST" }
    )
    expect(withQuery.status).toBe(403)
  })

  it("SETUP_SECRET 缺失 / 空值 / 占位符 → 500 失败关闭", async () => {
    for (const secret of [undefined, "", "SETUP_SECRET_PLACEHOLDER"]) {
      const { env, db } = makeContext({ SETUP_SECRET: secret })
      const res = await postSetup(env, {
        "x-setup-secret": "any-value"
      })
      expect(res.status).toBe(500)
      expect((await res.json()) as { code: string }).toMatchObject({
        code: "SETUP_UNAVAILABLE"
      })
      expect(tableNames(db)).toEqual([])
    }
  })
})

describe("setup：限流", () => {
  it("每 IP 每 10 分钟 3 次：第 4 次 429 并回 retryAfter，计数落库", async () => {
    const { env, db } = makeContext()
    const ip = { "cf-connecting-ip": "203.0.113.9" }

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await postSetup(env, { ...ip, "x-setup-secret": "wrong" })
      expect(res.status).toBe(403)
    }

    const limited = await postSetup(env, { ...ip, "x-setup-secret": "wrong" })
    expect(limited.status).toBe(429)
    const body = (await limited.json()) as {
      code: string
      retryAfter: number
    }
    expect(body.code).toBe("RATE_LIMITED")
    expect(body.retryAfter).toBeGreaterThan(0)

    const row = db.db
      .prepare(
        `SELECT count FROM ${countersTable(activePrefix(env))} WHERE action = 'setup'`
      )
      .get() as { count: number }
    expect(row.count).toBe(4)

    // 计数在 D1：换一份 env（相当于重启/换实例）仍然限流。
    const restarted = { ...env }
    const again = await postSetup(restarted, {
      ...ip,
      "x-setup-secret": TEST_SETUP_SECRET
    })
    expect(again.status).toBe(429)
  })

  it("不同 IP 各自计数，互不影响", async () => {
    const { env } = makeContext()
    for (let attempt = 0; attempt < 3; attempt++) {
      await postSetup(env, {
        "cf-connecting-ip": "203.0.113.10",
        "x-setup-secret": "wrong"
      })
    }
    const otherIp = await postSetup(env, {
      "cf-connecting-ip": "203.0.113.11",
      "x-setup-secret": TEST_SETUP_SECRET
    })
    expect(otherIp.status).toBe(200)
  })
})

describe("setup：前缀冲突", () => {
  it("库已在另一前缀初始化 → 409 可读 detail 且不建新表", async () => {
    const { env, db } = makeContext({ TABLE_PREFIX: "fleet" })
    const first = await postSetup(env, SECRET_HEADER)
    expect(first.status).toBe(200)
    const before = tableNames(db)

    const misconfigured = { ...env, TABLE_PREFIX: undefined }
    const res = await postSetup(misconfigured, SECRET_HEADER)
    expect(res.status).toBe(409)
    const body = (await res.json()) as {
      success: boolean
      code: string
      error: string
      resolvedPrefix: string
      detectedPrefixes: string[]
    }
    expect(body.success).toBe(false)
    expect(body.code).toBe("PREFIX_CONFLICT")
    expect(body.resolvedPrefix).toBe(DEFAULT_PREFIX)
    expect(body.detectedPrefixes).toEqual(["fleet_"])
    expect(body.error).toContain("TABLE_PREFIX")
    expect(tableNames(db)).toEqual(before)
  })

  it("冲突且密钥不对 → 403，不泄露检测到的前缀", async () => {
    const { env } = makeContext({ TABLE_PREFIX: "fleet" })
    await postSetup(env, SECRET_HEADER)

    const misconfigured = { ...env, TABLE_PREFIX: undefined }
    const res = await postSetup(misconfigured, { "x-setup-secret": "wrong" })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "Invalid setup secret" })
  })
})

describe("管理面数据库维护（POST /api/admin/setup）", () => {
  it("未登录 401、非管理员 403、停用用户 401", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)

    const anonymous = await request(env, "/api/admin/setup", {
      method: "POST"
    })
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get("cache-control")).toBe("no-store")

    const regular = await seedSession(db, prefix, { role: "user" })
    const forbidden = await request(env, "/api/admin/setup", {
      method: "POST",
      headers: { cookie: regular.cookie }
    })
    expect(forbidden.status).toBe(403)

    const disabled = await seedSession(db, prefix, {
      role: "admin",
      status: "disabled",
      email: "disabled-admin@example.test"
    })
    const refused = await request(env, "/api/admin/setup", {
      method: "POST",
      headers: { cookie: disabled.cookie }
    })
    expect(refused.status).toBe(401)
  })

  it("管理员重跑迁移：200，回显与密钥面完全同形", async () => {
    const adminContext = await initializedContext()
    const adminPrefix = activePrefix(adminContext.env)
    const admin = await seedSession(adminContext.db, adminPrefix, {
      role: "admin"
    })
    const adminRes = await request(adminContext.env, "/api/admin/setup", {
      method: "POST",
      headers: { cookie: admin.cookie }
    })
    expect(adminRes.status).toBe(200)
    const adminBody = await adminRes.json()

    const secretContext = await initializedContext()
    clearCounters(secretContext.db, activePrefix(secretContext.env))
    const secretRes = await postSetup(secretContext.env, SECRET_HEADER)
    expect(secretRes.status).toBe(200)
    const secretBody = await secretRes.json()

    expect(adminBody).toEqual(secretBody)
    expect(adminBody).toEqual({
      success: true,
      tablePrefix: adminPrefix,
      migrations: [{ name: "schema_v1", status: "skipped" }]
    })
  })

  it("管理面不提供删表/清库/重初始化入口", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const admin = await seedSession(db, prefix, { role: "admin" })

    for (const path of ["/api/admin/database", "/api/admin/setup/reset"]) {
      const res = await request(env, path, {
        method: "POST",
        headers: { cookie: admin.cookie }
      })
      expect(res.status).toBe(404)
    }
    expect(tableNames(db)).toContain(settingsTable(prefix))
  })
})

describe("前缀解析与默认常量", () => {
  it("默认部署（未配 TABLE_PREFIX）解析出配置里的默认前缀", () => {
    expect(getTablePrefix({})).toBe(DEFAULT_PREFIX)
  })
})

describe("未初始化时的鉴权边界", () => {
  it("带着伪造 Cookie 访问管理面 → 401（不因缺表变成 500）", async () => {
    const { env } = makeContext()
    const res = await request(env, "/api/admin/setup", {
      method: "POST",
      headers: { cookie: "session=forged" }
    })
    expect(res.status).toBe(401)
  })
})

describe("前缀配置非法", () => {
  it("TABLE_PREFIX 非法 → 全站 500 失败关闭，不建任何表", async () => {
    const { env, db } = makeContext({ TABLE_PREFIX: "2026" })
    const res = await request(env, "/api/setup/state")
    expect(res.status).toBe(500)
    expect(tableNames(db)).toEqual([])
  })
})
