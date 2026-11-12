/**
 * setup 接口（规格 §5.3）：初始化/升级页与密钥面。
 *
 * 契约要点：
 * - `GET /state`：无鉴权、no-store，只回 `{enabled, ownerExists, tablePrefix}`，
 *   不含密钥/哈希；未初始化时页面恒开（与存储值无关，防自锁）。
 * - `POST /`：纯升级端点（只跑迁移，不建用户、不改密码、不删数据）。密钥只认
 *   `X-Setup-Secret` 请求头、常量时间比较；密钥永不进 URL。
 * - 限流按 IP、每 10 分钟 3 次，计数在 D1（auth_counters），跨副本一致。
 * - 前缀冲突先做只读探测：冲突时一个表都不写，细节同样只在密钥正确时回。
 */
import { Hono } from "hono"
import { APP_MODE } from "../config/project"
import { hashPassword } from "../core/auth"
import { activeAdminExists, insertOwner } from "../db/queries/users"
import { isValidEmail } from "../services/email"
import { getTablePrefix } from "../lib/table-prefix"
import {
  findForeignPrefixConflict,
  isInitialized,
  isSetupPageEnabled,
  isSetupSecretConfigured,
  ownerExists,
  runSetup
} from "../lib/setup"
import { safeEqual } from "../core/auth"
import { consumeCounter, ensureCountersTable } from "../core/counters"
import type { Context } from "hono"
import type { HonoEnv } from "../types"

export const setupRoutes = new Hono<HonoEnv>()

/** setup 密钥面的限流口径（规格 §5.3.4）。 */
export const SETUP_RATE_LIMIT = {
  action: "setup",
  max: 3,
  windowSeconds: 600
}

function clientIp(c: Context<HonoEnv>): string {
  const forwarded = c.req.header("x-forwarded-for")
  return (
    c.req.header("cf-connecting-ip") ||
    (forwarded ? forwarded.split(",")[0].trim() : "") ||
    "unknown"
  )
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * 公开状态端点：只回答页面该怎么呈现（初始化 / 升级 / 已关闭）与生效前缀。
 * 未初始化时 `enabled` 恒 true；任何读取失败都按"未初始化"处理，不让首屏 500。
 */
setupRoutes.get("/state", async (c) => {
  c.header("Cache-Control", "no-store")
  const prefix = getTablePrefix(c.env)
  try {
    const initialized = await isInitialized(c.env.DB, prefix)
    if (!initialized) {
      return c.json({ enabled: true, ownerExists: false, tablePrefix: prefix })
    }
    return c.json({
      enabled: await isSetupPageEnabled(c.env.DB, prefix),
      ownerExists: await ownerExists(c.env.DB, prefix),
      tablePrefix: prefix
    })
  } catch {
    return c.json({ enabled: true, ownerExists: false, tablePrefix: prefix })
  }
})

setupRoutes.post("/", async (c) => {
  const prefix = getTablePrefix(c.env)
  const secretConfigured = isSetupSecretConfigured(c.env.SETUP_SECRET)

  // 密钥未配置/仍是占位符：失败关闭，绝不把空值当密钥比较。
  if (!secretConfigured) {
    console.error("SETUP_SECRET 缺失、为空或仍是占位值，setup 接口关闭")
    return c.json(
      { error: "Setup unavailable", code: "SETUP_UNAVAILABLE" },
      500
    )
  }

  const secretMatches = () =>
    safeEqual(
      c.req.header("X-Setup-Secret") ?? "",
      c.env.SETUP_SECRET as string
    )

  // 1) 只读前缀冲突探测：命中时一张表都不写（限流计数表也不建）。
  const conflict = await findForeignPrefixConflict(c.env).catch(() => null)
  if (conflict) {
    if (!(await secretMatches())) {
      return c.json({ error: "Invalid setup secret" }, 403)
    }
    const result = await runSetup(c.env)
    return c.json(result, 409)
  }

  // 2) 按 IP 限流（D1 计数表为权威）。计数不可用时宁拒绝也不放行无限重试。
  try {
    await ensureCountersTable(c.env.DB, prefix)
    const state = await consumeCounter(c.env.DB, prefix, {
      action: SETUP_RATE_LIMIT.action,
      ip: clientIp(c),
      windowSeconds: SETUP_RATE_LIMIT.windowSeconds
    })
    if (state.count > SETUP_RATE_LIMIT.max) {
      const retryAfter = Math.max(
        1,
        state.windowStart + SETUP_RATE_LIMIT.windowSeconds - nowSeconds()
      )
      return c.json(
        { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
        429
      )
    }
  } catch (err) {
    console.error(
      "Setup rate limit unavailable:",
      err instanceof Error ? err.message : err
    )
    return c.json({ error: "Setup unavailable" }, 500)
  }

  // 3) 密钥校验（计数排在比较之前：猜密钥的尝试同样被计数）。
  if (!(await secretMatches())) {
    return c.json({ error: "Invalid setup secret" }, 403)
  }

  // 4) 只跑迁移（纯升级）。
  try {
    const result = await runSetup(c.env)
    if (!result.success) return c.json(result, 409)
    return c.json(result)
  } catch (err) {
    console.error("Setup failed:", err instanceof Error ? err.message : err)
    return c.json({ error: "Setup failed" }, 500)
  }
})

/**
 * 单人档建唯一所有者（规格 §6.4「setup 初始化同页建唯一所有者」）。
 *
 * 刻意独立于 `POST /api/setup`：那条是纯升级端点（只跑迁移、不建用户），A 单已冻结
 * 并有测试锁住；建所有者另开一个端点，两者都只认同一个 `X-Setup-Secret`。
 * 多用户档不提供此端点（404），行为不变。
 */
setupRoutes.post("/owner", async (c) => {
  if (APP_MODE !== "single") {
    return c.json(
      {
        error: "Owner bootstrap is only available in single-user mode",
        code: "MODE_UNSUPPORTED"
      },
      404
    )
  }
  const prefix = getTablePrefix(c.env)
  if (!isSetupSecretConfigured(c.env.SETUP_SECRET)) {
    console.error("SETUP_SECRET 缺失、为空或仍是占位值，setup/owner 接口关闭")
    return c.json(
      { error: "Setup unavailable", code: "SETUP_UNAVAILABLE" },
      500
    )
  }
  if (!(await isInitialized(c.env.DB, prefix))) {
    return c.json(
      { error: "Run setup before creating the owner", code: "SETUP_REQUIRED" },
      409
    )
  }

  try {
    await ensureCountersTable(c.env.DB, prefix)
    const state = await consumeCounter(c.env.DB, prefix, {
      action: "setup_owner",
      ip: clientIp(c),
      windowSeconds: SETUP_RATE_LIMIT.windowSeconds
    })
    if (state.count > SETUP_RATE_LIMIT.max) {
      return c.json(
        {
          error: "Too many requests",
          code: "RATE_LIMITED",
          retryAfter: Math.max(
            1,
            state.windowStart + SETUP_RATE_LIMIT.windowSeconds - nowSeconds()
          )
        },
        429
      )
    }
  } catch (err) {
    console.error(
      "Setup owner rate limit unavailable:",
      err instanceof Error ? err.message : err
    )
    return c.json({ error: "Setup unavailable" }, 500)
  }

  const secretMatches = await safeEqual(
    c.req.header("X-Setup-Secret") ?? "",
    c.env.SETUP_SECRET as string
  )
  if (!secretMatches) {
    return c.json({ error: "Invalid setup secret" }, 403)
  }

  const body = await c.req
    .json<{ email?: string; password?: string }>()
    .catch(() => null)
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  const password = typeof body?.password === "string" ? body.password : ""
  if (!isValidEmail(email)) {
    return c.json(
      { error: "Invalid email address", code: "INVALID_EMAIL" },
      400
    )
  }
  if (password.length < 8) {
    return c.json(
      {
        error: "Password must be at least 8 characters",
        code: "WEAK_PASSWORD"
      },
      400
    )
  }

  if (await activeAdminExists(c.env.DB, prefix)) {
    return c.json(
      { error: "An active administrator already exists", code: "OWNER_EXISTS" },
      409
    )
  }

  await insertOwner(c.env.DB, prefix, {
    email,
    passwordHash: await hashPassword(password),
    language: "zh"
  })
  return c.json({ success: true }, 201)
})

// GET /api/setup 及未知子路径：明确拒绝，密钥永不进 URL。
setupRoutes.get("*", (c) => {
  c.header("Allow", "POST")
  return c.json(
    {
      error:
        "GET setup is deprecated. Use POST /api/setup with the X-Setup-Secret header."
    },
    405
  )
})
