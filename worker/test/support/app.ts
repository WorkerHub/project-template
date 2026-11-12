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
export const TEST_SIGNING_SECRET = "signing-secret-for-unit-tests-only"
export const TEST_APP_VERSION = "v0.0.0-7-abc1234"

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
    SIGNING_SECRET: TEST_SIGNING_SECRET,
    APP_VERSION: TEST_APP_VERSION,
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

// ─── B 单补充：Cookie / 设置 / 邮件 stub / 登录助手 ─────────────────────────────

/** Set-Cookie 头列表（Node 22+ 支持 getSetCookie）。 */
export function setCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie()
  const raw = res.headers.get("set-cookie")
  return raw ? [raw] : []
}

/** 取某个 Cookie 的 `name=value`（可直接放进 Cookie 请求头）。 */
export function cookieFrom(res: Response, name = SESSION_COOKIE): string {
  const prefix = `${name}=`
  for (const cookie of setCookies(res)) {
    const value = cookie.split(";")[0]
    if (value.startsWith(prefix)) return value
  }
  throw new Error(`cookie ${name} not found in response`)
}

/** 把多条 `name=value` 拼成 Cookie 请求头。 */
export function cookieHeader(...cookies: string[]): string {
  return cookies.join("; ")
}

/** 直接写一条站点设置（测试用来翻开关）。 */
export function writeSetting(
  db: SqliteD1,
  prefix: string,
  key: string,
  value: string
): void {
  db.db
    .prepare(
      `INSERT INTO ${settingsTable(prefix)} (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString())
}

export function jsonInit(
  body: unknown,
  headers: Record<string, string> = {}
): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  }
}

export function postJson(
  env: Env,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return request(env, path, jsonInit(body, headers))
}

export function patchJson(
  env: Env,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return request(env, path, {
    ...jsonInit(body, headers),
    method: "PATCH"
  })
}

export function putJson(
  env: Env,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return request(env, path, { ...jsonInit(body, headers), method: "PUT" })
}

export const TEST_PASSWORD = "correct-horse-battery"

export async function registerUser(
  env: Env,
  options: { email: string; password?: string; language?: string } = {
    email: "user@example.test"
  }
): Promise<Response> {
  return postJson(env, "/api/auth/register", {
    email: options.email,
    password: options.password ?? TEST_PASSWORD,
    language: options.language ?? "zh"
  })
}

export async function loginUser(
  env: Env,
  options: { email: string; password?: string }
): Promise<Response> {
  return postJson(env, "/api/auth/login", {
    email: options.email,
    password: options.password ?? TEST_PASSWORD
  })
}

/** 注册 + 登录，返回会话 Cookie（用于需要已登录的用例）。 */
export async function registerAndLogin(
  env: Env,
  options: { email: string; password?: string; language?: string }
): Promise<{ cookie: string; register: Response; login: Response }> {
  const register = await registerUser(env, options)
  const login = await loginUser(env, options)
  return { cookie: cookieFrom(login), register, login }
}

export interface SentEmail {
  to: string
  subject: string
  html: string
  text: string
  from: string
}

export interface FetchStub {
  sent: SentEmail[]
  restore: () => void
}

/**
 * 把 Resend 的 HTTPS 调用换成内存 stub（规格 §7-9：smtp/resend 各以 stub 跑通
 * 发送与错误路径）。`fail` 用来验证「错误原文回显」。
 */
export function stubResend(
  options: { fail?: { status: number; body: string } } = {}
): FetchStub {
  const sent: SentEmail[] = []
  const original = globalThis.fetch
  const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (!url.startsWith("https://api.resend.com/emails")) {
      return original(input as never, init)
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      to?: string[]
      subject?: string
      html?: string
      text?: string
      from?: string
    }
    if (options.fail) {
      return new Response(options.fail.body, { status: options.fail.status })
    }
    sent.push({
      to: body.to?.[0] ?? "",
      subject: body.subject ?? "",
      html: body.html ?? "",
      text: body.text ?? "",
      from: body.from ?? ""
    })
    return new Response(JSON.stringify({ id: "stub" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  }) as typeof fetch
  globalThis.fetch = stub
  return {
    sent,
    restore: () => {
      globalThis.fetch = original
    }
  }
}

/** 配好 Resend 通道（配合 stubResend 使用）。 */
export function configureResend(db: SqliteD1, prefix: string): void {
  writeSetting(db, prefix, "email_provider", "resend")
  writeSetting(
    db,
    prefix,
    "resend_config",
    JSON.stringify({
      api_key: "re_test_key",
      from: "noreply@example.test",
      from_name: "Template"
    })
  )
}

/** 从 stub 收到的邮件里取 6 位验证码。 */
export function codeFromEmail(email: SentEmail | undefined): string {
  const match = `${email?.text ?? ""}${email?.html ?? ""}`.match(/\d{6}/)
  if (!match) throw new Error("no 6-digit code in email")
  return match[0]
}
