import { app } from "../../src/index"
import { getTablePrefix } from "../../src/lib/table-prefix"
import { runSetup } from "../../src/lib/setup"
import {
  countersTable,
  sessionsTable,
  settingsTable,
  usersTable
} from "../../src/lib/tables"
import { sha256Hex } from "../../src/core/auth"
import { SESSION_COOKIE } from "../../src/core/session"
import type { Env } from "../../src/types"
import { SqliteD1 } from "./sqlite-d1"

export const TEST_SETUP_SECRET = "test-setup-secret"

/** 静态资源替身：只要 `/` 回 HTML，其余 404（触发 SPA 回落的前半段）。 */
function assets(): Fetcher {
  return {
    fetch: async (request: Request) => {
      const { pathname } = new URL(request.url)
      if (pathname === "/") {
        return new Response("<html>spa</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      }
      return new Response("not found", { status: 404 })
    }
  } as unknown as Fetcher
}

export interface TestContext {
  env: Env
  db: SqliteD1
}

/** 新环境：空库 + 假静态资源 + 测试密钥；默认不设 TABLE_PREFIX（走默认前缀）。 */
export function makeContext(overrides: Partial<Env> = {}): TestContext {
  const db = new SqliteD1()
  const env = {
    DB: db as unknown as D1Database,
    ASSETS: assets(),
    SETUP_SECRET: TEST_SETUP_SECRET,
    ...overrides
  } as Env
  return { env, db }
}

/** 已初始化（默认前缀）的环境。 */
export async function initializedContext(
  overrides: Partial<Env> = {}
): Promise<TestContext> {
  const context = makeContext(overrides)
  const result = await runSetup(context.env)
  if (!result.success) {
    throw new Error(`setup failed in test fixture: ${result.code}`)
  }
  return context
}

/** 发一个请求给 Worker（Hono 的 app.request，第三参注入 Env）。 */
export function request(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return app.request(`http://worker.test${path}`, init, env)
}

export function activePrefix(env: Env): string {
  return getTablePrefix(env)
}

export interface SeededSession {
  userId: number
  sessionId: string
  token: string
  /** 可直接放进请求头的 Cookie。 */
  cookie: string
}

/**
 * 直接插一行用户 + 一行会话（绕过登录流程：登录由后续单实现）。
 * 返回明文令牌——这里刻意由测试持有，库里只会有它的 SHA-256。
 */
export async function seedSession(
  db: SqliteD1,
  prefix: string,
  options: {
    role?: "admin" | "user"
    status?: "pending" | "active" | "disabled"
    email?: string
    expiresIn?: number
  } = {}
): Promise<SeededSession> {
  const now = Math.floor(Date.now() / 1000)
  const email = options.email ?? `${options.role ?? "user"}@example.test`
  const token = `token-${Math.random().toString(36).slice(2)}`
  const tokenHash = await sha256Hex(token)
  const sessionId = crypto.randomUUID()

  const user = db.db
    .prepare(
      `INSERT INTO ${usersTable(prefix)}
        (email, password_hash, role, status, email_verified, language, display_name, timezone, theme, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'zh', '', 'Asia/Shanghai', 'system', ?, ?)`
    )
    .run(
      email,
      "hash",
      options.role ?? "user",
      options.status ?? "active",
      new Date().toISOString(),
      new Date().toISOString()
    )
  const userId = Number(user.lastInsertRowid)

  db.db
    .prepare(
      `INSERT INTO ${sessionsTable(prefix)}
        (id, token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, '', '')`
    )
    .run(
      sessionId,
      tokenHash,
      userId,
      now,
      now,
      now + (options.expiresIn ?? 3600)
    )

  return {
    userId,
    sessionId,
    token,
    cookie: `${SESSION_COOKIE}=${token}`
  }
}

/** 清空计数表（用例之间互不影响）；表还不存在时静默跳过。 */
export function clearCounters(
  db: SqliteD1,
  prefix: string,
  action?: string
): void {
  const table = countersTable(prefix)
  try {
    if (action) {
      db.db.prepare(`DELETE FROM ${table} WHERE action = ?`).run(action)
    } else {
      db.db.prepare(`DELETE FROM ${table}`).run()
    }
  } catch {
    // 表还没建出来：没有计数可清。
  }
}

/** 当前库里的全部表名（升序）。 */
export function tableNames(db: SqliteD1): string[] {
  return db.db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((row) => (row as { name: string }).name)
}

export function readSetting(
  db: SqliteD1,
  prefix: string,
  key: string
): string | null {
  const row = db.db
    .prepare(`SELECT value FROM ${settingsTable(prefix)} WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}
