/**
 * 会话读取侧（规格 §5.4）：不透明令牌 + SHA-256 哈希落库。
 *
 * Cookie 里是 32 字节随机令牌，`sessions` 表只存它的 SHA-256——库被读也拿不到
 * 可用凭证。每次请求都回表校验，删行/停用/未批准立即失效。
 *
 * 建会话、续期、登出与登录流程由后续的鉴权单补齐；本单只提供读取侧，
 * 让 /api/admin/setup 能做管理员鉴权。
 */
import type { Context } from "hono"
import { getCookie } from "hono/cookie"
import { sha256Hex } from "./auth"
import { sessionsTable, usersTable } from "../lib/tables"
import type { HonoEnv } from "../types"

export const SESSION_COOKIE = "session"

export interface SessionLookup {
  sessionId: string
  userId: number
  role: string
}

/** 从 Cookie 里读会话令牌；没有则 null。 */
export function readSessionToken(c: Context<HonoEnv>): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null
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
