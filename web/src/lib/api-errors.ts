/**
 * 错误 → 用户可读文案的唯一入口（规格 §6.5：后端只给稳定错误码，前端翻译）。
 *
 * 未知 code 一律回落到通用失败文案，绝不把后端英文/中文原文摆到界面上；
 * 已知 code 里需要秒数的（限流）用 retryAfter 插值。
 */
import type { TFunction } from "i18next"
import { ApiError } from "@/lib/api"

/** 已经被消费掉的错误不再展示（如用户取消 Passkey）。 */
export function describeApiError(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t("errors.generic")

  if (error.status === 0) return t("errors.network")

  if (error.code) {
    return t(`errors.codes.${error.code}`, {
      seconds: error.retryAfter ?? 60,
      defaultValue: t("errors.generic")
    })
  }

  if (error.status === 401) return t("errors.codes.UNAUTHORIZED")
  if (error.status === 403) return t("errors.codes.FORBIDDEN")
  return t("errors.generic")
}

/** 429 的倒计时起点（没有该头时给一个保守默认值）。 */
export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null
  if (error.status !== 429) return null
  const seconds = error.retryAfter
  return typeof seconds === "number" && seconds > 0 ? Math.ceil(seconds) : 60
}
