/**
 * auth_counters（限流 / 连续失败锁定的唯一权威）的行为锁：
 * 前缀命名、迁移前幂等建表、窗口重开、锁定写入。后续单的登录限流复用它。
 */
import { describe, expect, it } from "vitest"
import {
  consumeCounter,
  ensureCountersTable,
  lockCounter
} from "../src/core/counters"
import { countersTable } from "../src/lib/tables"
import { activePrefix, makeContext, tableNames } from "./support/app"

async function contextWithCounters() {
  const context = makeContext()
  const prefix = activePrefix(context.env)
  await ensureCountersTable(context.env.DB, prefix)
  return { ...context, prefix }
}

describe("计数表", () => {
  it("按生效前缀命名，且建表幂等（迁移之前也能用）", async () => {
    const { env, db, prefix } = await contextWithCounters()
    await ensureCountersTable(env.DB, prefix)
    await ensureCountersTable(env.DB, prefix)

    expect(tableNames(db)).toContain(countersTable(prefix))
    // 没跑过迁移：只有计数表，没有用户表。
    expect(tableNames(db)).toEqual([countersTable(prefix)])
  })
})

describe("计数语义", () => {
  it("同一窗口内逐次自增", async () => {
    const { env, prefix } = await contextWithCounters()
    const key = { action: "setup", ip: "203.0.113.7", windowSeconds: 600 }

    expect((await consumeCounter(env.DB, prefix, key, 1000)).count).toBe(1)
    expect((await consumeCounter(env.DB, prefix, key, 1001)).count).toBe(2)
    expect((await consumeCounter(env.DB, prefix, key, 1002)).count).toBe(3)
  })

  it("窗口过期后重新从 1 计", async () => {
    const { env, prefix } = await contextWithCounters()
    const key = { action: "setup", ip: "203.0.113.7", windowSeconds: 600 }
    await consumeCounter(env.DB, prefix, key, 1000)
    await consumeCounter(env.DB, prefix, key, 1599)

    const reopened = await consumeCounter(env.DB, prefix, key, 1601)
    expect(reopened.count).toBe(1)
    expect(reopened.windowStart).toBe(1601)
  })

  it("不同 IP / 账号 / 动作各自计数，互不覆盖", async () => {
    const { env, prefix } = await contextWithCounters()
    await consumeCounter(env.DB, prefix, {
      action: "login",
      account: "a@example.test",
      ip: "1.1.1.1",
      windowSeconds: 600
    })
    const otherIp = await consumeCounter(env.DB, prefix, {
      action: "login",
      account: "a@example.test",
      ip: "198.51.100.8",
      windowSeconds: 600
    })
    const otherAction = await consumeCounter(env.DB, prefix, {
      action: "setup",
      ip: "1.1.1.1",
      windowSeconds: 600
    })

    expect(otherIp.count).toBe(1)
    expect(otherAction.count).toBe(1)
  })

  it("lockCounter 写入 locked_until，后续计数读得到", async () => {
    const { env, prefix } = await contextWithCounters()
    const key = {
      action: "login",
      account: "b@example.test",
      ip: "198.51.100.9"
    }
    await lockCounter(env.DB, prefix, key, 300, 2000)

    const state = await consumeCounter(
      env.DB,
      prefix,
      { ...key, windowSeconds: 600 },
      2000
    )
    expect(state.lockedUntil).toBe(2300)
  })
})
