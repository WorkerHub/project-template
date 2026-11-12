/**
 * 限流判定（规格 §5.4）：把 `core/counters.ts` 的计数样板收成一句话。
 *
 * 存储与原子性仍由计数表负责（D1，跨副本一致，不新增资源）；本文件只负责把
 * 「本窗口内第几次」翻译成 allowed / retryAfter，路由据此回 429。
 */
import { consumeCounter, type CounterKey } from "./counters"

export interface RateLimitRule extends CounterKey {
  windowSeconds: number
  max: number
}

export interface RateLimitVerdict {
  allowed: boolean
  /** 超出上限时距窗口重开还有多少秒（>= 1）。 */
  retryAfter: number
}

export async function enforceRateLimit(
  db: D1Database,
  prefix: string,
  rule: RateLimitRule,
  now = Math.floor(Date.now() / 1000)
): Promise<RateLimitVerdict> {
  const state = await consumeCounter(
    db,
    prefix,
    {
      action: rule.action,
      account: rule.account,
      ip: rule.ip,
      windowSeconds: rule.windowSeconds
    },
    now
  )
  if (state.count <= rule.max) return { allowed: true, retryAfter: 0 }
  return {
    allowed: false,
    retryAfter: Math.max(1, state.windowStart + rule.windowSeconds - now)
  }
}
