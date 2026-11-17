import type { Me } from "@/lib/api-types"

type AccountIdentity = Pick<Me, "displayName" | "email">

/**
 * 账号主显示名：显示名称 → 邮箱，取第一个非空值。
 *
 * 顶栏下拉的身份块与头像首字共用这一条回退链，别在组件里另写。
 */
export function accountPrimaryLabel(
  user: AccountIdentity | null | undefined
): string {
  if (!user) return ""
  return user.displayName || user.email || ""
}

/**
 * 头像首字：按码点取主显示名的第一个字符并转大写。
 *
 * `Array.from` 保证代理对（emoji 等）不被截成半个码元；中文转大写不变。
 */
export function accountInitial(
  user: AccountIdentity | null | undefined
): string {
  return Array.from(accountPrimaryLabel(user))[0]?.toUpperCase() ?? ""
}
