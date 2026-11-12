/**
 * waker 接入的唯一开关（规格 §5.5A、§8）：只认 `WAKER_SIGNING_KEY` 的取值，
 * 不设模式变量。
 *
 * 三态判定（唯一判定处，`scheduled()` 与回调口都从这里取）：
 *   - `unconfigured`（未配置）→ 内置 Cron 跑定时任务；回调口失败关闭；
 *   - `disabled`（显式关闭，保留值小写 `false`）→ 两个入口都不自动跑，
 *     `scheduled()` 跳过且不回落 Cron；回调口同样失败关闭；
 *   - `configured`（已配置）→ waker 回调接管，`scheduled()` 自行跳过。
 *
 * 「未配置」的口径与 setup 密钥一致：非字符串、trim 后为空、或仍是
 * `*_PLACEHOLDER` 模板值。保留值只认小写 `false`，且绝不作为验签钥使用。
 */
import type { Env } from "../types"

/** 保留值：把 `WAKER_SIGNING_KEY` 设为它表示显式关闭自动触发（大小写敏感）。 */
export const WAKER_SIGNING_KEY_DISABLED = "false"

export type WakerGateState = "unconfigured" | "disabled" | "configured"

function normalizeKey(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null
  const key = raw.trim()
  if (key.length === 0) return null
  if (key.endsWith("_PLACEHOLDER")) return null
  return key
}

export function wakerGateState(
  env: Pick<Env, "WAKER_SIGNING_KEY">
): WakerGateState {
  const key = normalizeKey(env.WAKER_SIGNING_KEY)
  if (key === null) return "unconfigured"
  if (key === WAKER_SIGNING_KEY_DISABLED) return "disabled"
  return "configured"
}

/** 生效的验签钥：只有「已配置」态返回字符串；其余一律 null。 */
export function wakerSigningKey(
  env: Pick<Env, "WAKER_SIGNING_KEY">
): string | null {
  const key = normalizeKey(env.WAKER_SIGNING_KEY)
  if (key === null || key === WAKER_SIGNING_KEY_DISABLED) return null
  return key
}
