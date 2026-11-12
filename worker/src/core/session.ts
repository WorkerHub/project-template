/**
 * 会话读写（规格 §5.4）：不透明令牌 + SHA-256 哈希落库。
 *
 * Cookie 里是 32 字节随机令牌，`sessions` 表只存它的 SHA-256——库被读也拿不到
 * 可用凭证。每次请求都回表校验，删行/停用/未批准立即失效。
 *
 * 读侧 `findSession` 由 setup 单提供（管理面无密码登录时就要用）；本文件补写侧：
 * 发会话、吊销单个、吊销某用户全部（改密/找回密码后失效旧会话）。
 */
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import type { Context } from "hono"
import { randomToken, sha256Hex } from "./auth"
import { sessionsTable, usersTable } from "../lib/tables"
import type { HonoEnv } from "../types"

export const SESSION_COOKIE = "session"

/** 会话有效期（秒）：7 天。 */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export interface SessionLookup {
  sessionId: string
  userId: number
  role: string
}

export interface CreatedSession {
  /** 明文令牌（只进 Set-Cookie，库里只有它的哈希）。 */
  token: string
  sessionId: string
  expiresAt: number
}

export interface RequestMeta {
  ip: string
  userAgent: string
}

/** 从 Cookie 里读会话令牌；没有则 null。 */
export function readSessionToken(c: Context<HonoEnv>): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null
}

export function setSessionCookie(
  c: Context<HonoEnv>,
  token: string,
  maxAge = SESSION_TTL_SECONDS
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge
  })
}

export function clearSessionCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" })
}

/** 建会话行并返回明文令牌；Cookie 由调用方用 setSessionCookie 写入。 */
export async function createSession(
  db: D1Database,
  prefix: string,
  userId: number,
  meta: RequestMeta,
  now = Math.floor(Date.now() / 1000)
): Promise<CreatedSession> {
  const token = randomToken(32)
  const sessionId = crypto.randomUUID()
  const expiresAt = now + SESSION_TTL_SECONDS
  await db
    .prepare(
      `INSERT INTO ${sessionsTable(prefix)}
        (id, token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      sessionId,
      await sha256Hex(token),
      userId,
      now,
      now,
      expiresAt,
      meta.ip,
      meta.userAgent
    )
    .run()
  return { token, sessionId, expiresAt }
}

/** 吊销单个会话（登出）。行不存在也算成功：幂等。 */
export async function revokeSession(
  db: D1Database,
  prefix: string,
  sessionId: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${sessionsTable(prefix)} WHERE id = ?`)
    .bind(sessionId)
    .run()
}

/**
 * 吊销某用户的会话。`exceptSessionId` 用于「改密后保留本次登录」：改密本身不踢
 * 当前浏览器，其余会话一律失效。
 */
export async function revokeAllSessions(
  db: D1Database,
  prefix: string,
  userId: number,
  exceptSessionId?: string
): Promise<void> {
  if (exceptSessionId) {
    await db
      .prepare(
        `DELETE FROM ${sessionsTable(prefix)} WHERE user_id = ? AND id != ?`
      )
      .bind(userId, exceptSessionId)
      .run()
    return
  }
  await db
    .prepare(`DELETE FROM ${sessionsTable(prefix)} WHERE user_id = ?`)
    .bind(userId)
    .run()
}

/**
 * 令牌 → 会话行。校验三件事：token_hash 命中、未过期、用户处于可用状态
 * （`status = 'active'`）。任一不满足都当未登录。
 */
export async function findSession(
  db: D1Database,
  prefix: string,
  token: string
): Promise<SessionLookup | null> {
  const tokenHash = await sha256Hex(token)
  let row: {
    session_id: string
    user_id: number
    expires_at: number
    role: string
    status: string
  } | null = null
  try {
    row = await db
      .prepare(
        `SELECT s.id AS session_id, s.user_id, s.expires_at, u.role, u.status
           FROM ${sessionsTable(prefix)} s
           JOIN ${usersTable(prefix)} u ON u.id = s.user_id
          WHERE s.token_hash = ?`
      )
      .bind(tokenHash)
      .first<{
        session_id: string
        user_id: number
        expires_at: number
        role: string
        status: string
      }>()
  } catch {
    // 库还没初始化（表不存在）时按未登录处理：会话读侧 fail closed，
    // 不把鉴权失败升级成 500。
    return null
  }
  if (!row) return null
  if (row.expires_at <= Math.floor(Date.now() / 1000)) return null
  if (row.status !== "active") return null
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    role: row.role
  }
}
