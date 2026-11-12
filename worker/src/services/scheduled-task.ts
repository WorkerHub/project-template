/**
 * 定时任务桩（规格 §5.5A、§8）：只有一个写日志的 no-op 任务，外加「D1 状态抢占」
 * 的示例写法——两个入口（原生 Cron 与 waker 回调）共用这一份实现，靠计数表判定
 * 「同一小时窗口内是否已有别的入口跑过」，因此不会双跑。
 *
 * 不放任何真实业务任务：这是骨架，生成项目后往里加自己的 job。
 */
import { consumeCounter, ensureCountersTable } from "../core/counters"
import { getTablePrefix } from "../lib/table-prefix"
import type { Env } from "../types"

/** 示例任务名：waker 侧注册也用这个 key。 */
export const SCHEDULED_TASK_NAME = "noop-log-tick"

/** 抢占窗口（秒）：一小时内只有第一个入口真正执行。 */
const CLAIM_WINDOW_SECONDS = 60 * 60

export type ScheduledTrigger = "cron" | "waker"

export interface ScheduledTaskOutcome {
  ran: boolean
  /** 没跑的原因，便于回调响应与日志排查。 */
  reason?: "already-claimed"
}

/**
 * 跑一轮定时任务（幂等）：先用计数表抢占本轮，抢到才执行。
 * `now` 可注入，测试用它推进小时窗口而不必真等。
 */
export async function runScheduledTask(
  env: Env,
  options: { trigger: ScheduledTrigger; now?: number }
): Promise<ScheduledTaskOutcome> {
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const prefix = getTablePrefix(env)
  await ensureCountersTable(env.DB, prefix)

  const claim = await consumeCounter(
    env.DB,
    prefix,
    {
      action: "scheduled_tick",
      account: SCHEDULED_TASK_NAME,
      windowSeconds: CLAIM_WINDOW_SECONDS
    },
    now
  )

  if (claim.count > 1) {
    console.info(
      `scheduled: ${SCHEDULED_TASK_NAME} 本轮已被另一入口执行（trigger=${options.trigger}）`
    )
    return { ran: false, reason: "already-claimed" }
  }

  console.info(
    `scheduled: ${SCHEDULED_TASK_NAME} 执行（trigger=${options.trigger}, at=${new Date(
      now * 1000
    ).toISOString()}）`
  )
  return { ran: true }
}
