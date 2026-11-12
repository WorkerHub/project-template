/**
 * 返回给前端自己的用户视图（登录成功、`GET /api/me`、`PATCH /api/me` 共用同一形状）。
 *
 * 绝不包含 `password_hash`、`totp_secret` 或通行密钥的公钥/凭据 id——只给「开了
 * 哪些第二因子」的布尔与计数。
 */
import { getTablePrefix } from "./table-prefix"
import { countPasskeys } from "../db/queries/passkeys"
import { getTwoFactor } from "../db/queries/twofa"
import type { UserRow } from "../db/queries/users"
import type { Env } from "../types"

export interface UserView {
  id: number
  email: string
  displayName: string
  role: string
  status: string
  language: string
  timezone: string
  theme: string
  emailVerified: boolean
  twoFactor: {
    totpEnabled: boolean
    passkeyCount: number
  }
}

export async function buildUserView(
  env: Env,
  user: UserRow
): Promise<UserView> {
  const prefix = getTablePrefix(env)
  const twoFactor = await getTwoFactor(env.DB, prefix, user.id)
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    language: user.language,
    timezone: user.timezone,
    theme: user.theme,
    emailVerified: user.email_verified === 1,
    twoFactor: {
      totpEnabled: Boolean(twoFactor?.totp_enabled),
      passkeyCount: await countPasskeys(env.DB, prefix, user.id)
    }
  }
}
