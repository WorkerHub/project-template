/**
 * IANA 时区名校验的唯一处：运行时交给 Intl 判，不自己维护清单。
 * `me.ts` 的资料偏好与管理端的建号端点共用同一口径。
 */
export function isValidTimezone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}
