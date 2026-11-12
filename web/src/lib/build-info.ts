/**
 * 构建信息（规格 §6.3）：值由 scripts/build-info.mjs 在构建前从 git 生成，
 * 源码里没有任何写死的版本号/日期。
 *
 * 未登录页脚与「关于」页都只读这里的 `buildInfo`，保证两处同源。
 */
import raw from "../../../build-info.json"

export interface BuildInfo {
  /** v<semver>-<提交数>-<短哈希>，如 v1.3.0-8-479967d */
  version: string
  commit: string
  commitCount: number
  /** ISO 时间（构建时刻） */
  builtAt: string
  timeZone: string
  /** +08:00 / -05:00 之类的 UTC 偏移 */
  offset: string
}

export const buildInfo = raw as BuildInfo

function format(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: buildInfo.timeZone,
    ...options
  }).format(date)
}

/** YYYY-MM-DD（构建时区）。 */
export function formatBuildDate(): string {
  const date = new Date(buildInfo.builtAt)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: buildInfo.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date)
}

/** HH:mm:ss（24 小时制，构建时区）。 */
export function formatBuildTime(): string {
  return format(new Date(buildInfo.builtAt), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  })
}

/** 构建时区标签：Asia/Shanghai (UTC+08:00)。 */
export function buildTimeZoneLabel(): string {
  return `${buildInfo.timeZone} (UTC${buildInfo.offset})`
}
