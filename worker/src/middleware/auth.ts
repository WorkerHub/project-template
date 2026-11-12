/**
 * 会话校验中间件：Cookie 令牌 → SHA-256 → `sessions` 行（连 users 校验状态）。
 * 会话行被删、过期、用户被停用/未批准都立即 401。
 */
import type { Context, Next } from "hono"
import { getTablePrefix } from "../lib/table-prefix"
import { findSession, readSessionToken } from "../core/session"
import type { HonoEnv } from "../types"

function unauthorized(c: Context<HonoEnv>) {
  c.header("Cache-Control", "no-store")
  return c.json({ error: "Unauthorized" }, 401)
}

export async function authMiddleware(c: Context<HonoEnv>, next: Next) {
  const token = readSessionToken(c)
  if (!token) return unauthorized(c)

  const session = await findSession(c.env.DB, getTablePrefix(c.env), token)
  if (!session) return unauthorized(c)

  c.set("userId", session.userId)
  c.set("role", session.role)
  c.set("sessionId", session.sessionId)

  await next()
}
