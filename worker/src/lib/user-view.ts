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

import { readProfileLockSettings } from "./settings"
export interface UserView {
  id: number
  email: string
  displayName: string
  role: string
  status: string
  language: string
  timezone: string
  emailVerified: boolean
  /** 首登强制改密标记；true 时前端引导改密后再放行。 */
  mustChangePassword: boolean
  totpEnabled: boolean
  emailTwoFactorEnabled: boolean
  passkeyCount: number
  profileLocks: {
    displayNameLocked: boolean
  }
}

export async function buildUserView(
  env: Env,
  user: UserRow
): Promise<UserView> {
  const prefix = getTablePrefix(env)
  const twoFactor = await getTwoFactor(env.DB, prefix, user.id)
  const passkeyCount = await countPasskeys(env.DB, prefix, user.id)
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    language: user.language,
    timezone: user.timezone,
    emailVerified: user.email_verified === 1,
    mustChangePassword: user.must_change_password === 1,
    totpEnabled: Boolean(twoFactor?.totp_enabled),
    emailTwoFactorEnabled: Boolean(twoFactor?.email_2fa_enabled),
    passkeyCount,
    profileLocks: await readProfileLockSettings(env)
  }
}
