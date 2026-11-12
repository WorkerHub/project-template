/**
 * 会话内的账号操作守卫（个人设置、2FA 绑定、通行密钥共用）。
 *
 * 敏感动作一律要求重新输入当前密码（与 eNotify 的口径一致）：改密、关 TOTP、
 * 删除/新增通行密钥。这里只做「密码对不对」，不负责会话校验——会话由
 * `index.ts` 的全局中间件统一处理。
 */
import type { Context } from "hono"
import { verifyPassword } from "../core/auth"
import { findUserById } from "../db/queries/users"
import { apiError } from "./http"
import { getTablePrefix } from "./table-prefix"
import type { HonoEnv } from "../types"

export type AccountContext = Context<HonoEnv>

export function currentUserId(c: AccountContext): number {
  return c.get("userId")
}

/** 校验请求体里的当前密码；通过返回 null，否则返回可直接 return 的错误响应。 */
export async function requirePassword(
  c: AccountContext,
  password: unknown
): Promise<Response | null> {
  if (typeof password !== "string" || password.length === 0) {
    return apiError(c, 400, "PASSWORD_INCORRECT", "Password is required")
  }
  const prefix = getTablePrefix(c.env)
  const user = await findUserById(c.env.DB, prefix, currentUserId(c))
  if (!user) return apiError(c, 404, "USER_NOT_FOUND", "User not found")
  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) {
    return apiError(c, 403, "PASSWORD_INCORRECT", "Password is incorrect")
  }
  return null
}
