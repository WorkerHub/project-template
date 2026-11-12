/**
 * 规格 §5.5A（定时任务桩 + waker 双模式骨架）：
 * - 唯一开关 `WAKER_SIGNING_KEY` 的三态：未配置 / `false` / 已配置；
 * - 已配置 → 原生 `scheduled()` 让路，回调验签后执行；
 * - 验签（HMAC-SHA256、300 秒窗）、未知任务、ids 不一致都被拒；
 * - 两个入口共用 no-op 任务，靠 D1 计数表抢占，一小时内只跑一次。
 */
import { describe, expect, it } from "vitest"
import worker from "../src/index"
import { wakerGateState, wakerSigningKey } from "../src/core/waker-gate"
import { countersTable } from "../src/lib/tables"
import type { Env } from "../src/types"
import {
  activePrefix,
  initializedContext,
  makeContext,
  request
} from "./support/app"

const SIGNING_KEY = "waker-signing-key-for-tests"
const JOB = "noop-log-tick"

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  )
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

interface CallbackOptions {
  secret?: string
  jobName?: string
  executionId?: string
  jobId?: string
  timestamp?: number
  bodyOverride?: string
  omitSignature?: boolean
}

async function callback(
  env: Env,
  options: CallbackOptions = {}
): Promise<Response> {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
  const executionId = options.executionId ?? crypto.randomUUID()
  const jobId = options.jobId ?? "job-1"
  const body =
    options.bodyOverride ??
    JSON.stringify({
      protocolVersion: 2,
      executionId,
      jobId,
      jobName: options.jobName ?? JOB,
      payload: null
    })
  const signature = await hmacHex(
    options.secret ?? SIGNING_KEY,
    `${timestamp}\n${executionId}\n${jobId}\n${body}`
  )
  return request(env, "/_waker/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-waker-timestamp": timestamp,
      "x-waker-execution-id": executionId,
      "x-waker-job-id": jobId,
      ...(options.omitSignature
        ? {}
        : { "x-waker-signature": `v2=${signature}` })
    },
    body
  })
}

describe("waker 开关三态", () => {
  it("未配置 / 保留值 false / 已配置", () => {
    expect(wakerGateState({})).toBe("unconfigured")
    expect(wakerGateState({ WAKER_SIGNING_KEY: "  " })).toBe("unconfigured")
    expect(
      wakerGateState({ WAKER_SIGNING_KEY: "WAKER_SIGNING_KEY_PLACEHOLDER" })
    ).toBe("unconfigured")
    expect(wakerGateState({ WAKER_SIGNING_KEY: "false" })).toBe("disabled")
    expect(wakerGateState({ WAKER_SIGNING_KEY: "False" })).toBe("configured")
    expect(wakerGateState({ WAKER_SIGNING_KEY: SIGNING_KEY })).toBe(
      "configured"
    )

    expect(wakerSigningKey({})).toBeNull()
    expect(wakerSigningKey({ WAKER_SIGNING_KEY: "false" })).toBeNull()
    expect(wakerSigningKey({ WAKER_SIGNING_KEY: SIGNING_KEY })).toBe(
      SIGNING_KEY
    )
  })
})

describe("waker 回调", () => {
  it("签名钥未配置或显式 false：500 signing_key_missing，且不碰数据库", async () => {
    for (const key of [undefined, "false"]) {
      const { env, db } = await initializedContext(
        key === undefined ? {} : { WAKER_SIGNING_KEY: key }
      )
      const res = await callback(env, { secret: "irrelevant" })
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe("signing_key_missing")
      const rows = db.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${countersTable(activePrefix(env))} WHERE action = 'scheduled_tick'`
        )
        .get() as { n: number }
      expect(rows.n).toBe(0)
    }
  })

  it("合法签名执行 no-op 任务；同一小时窗口的第二次触发只汇报 already-claimed", async () => {
    const { env } = await initializedContext({ WAKER_SIGNING_KEY: SIGNING_KEY })
    const first = await callback(env)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, ran: true })

    const second = await callback(env)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already-claimed"
    })
  })

  it("坏签名 / 缺签名 → 401 invalid_signature；过期时间戳 → 401 stale_timestamp", async () => {
    const { env } = await initializedContext({ WAKER_SIGNING_KEY: SIGNING_KEY })

    const bad = await callback(env, { secret: "wrong-key" })
    expect(bad.status).toBe(401)
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_signature"
    )

    const missing = await callback(env, { omitSignature: true })
    expect(missing.status).toBe(400)

    const stale = await callback(env, {
      timestamp: Math.floor(Date.now() / 1000) - 3600
    })
    expect(stale.status).toBe(401)
    expect(
      ((await stale.json()) as { error: { code: string } }).error.code
    ).toBe("stale_timestamp")
  })

  it("未知任务 404、body 与签名头 id 不一致 400", async () => {
    const { env } = await initializedContext({ WAKER_SIGNING_KEY: SIGNING_KEY })

    const unknown = await callback(env, { jobName: "cleanup-everything" })
    expect(unknown.status).toBe(404)
    expect(
      ((await unknown.json()) as { error: { code: string } }).error.code
    ).toBe("unknown_job")

    const mismatch = await callback(env, {
      bodyOverride: JSON.stringify({
        executionId: "other",
        jobId: "job-1",
        jobName: JOB
      })
    })
    expect(mismatch.status).toBe(400)
    expect(
      ((await mismatch.json()) as { error: { code: string } }).error.code
    ).toBe("invalid_request")
  })
})

describe("原生 scheduled() 让路", () => {
  it("未配置 → 自己跑 no-op 任务并留下抢占记录", async () => {
    const { env, db } = await initializedContext()
    await worker.scheduled({} as never, env, {} as never)

    const row = db.db
      .prepare(
        `SELECT count FROM ${countersTable(activePrefix(env))} WHERE action = 'scheduled_tick'`
      )
      .get() as { count: number } | undefined
    expect(row?.count).toBe(1)
  })

  it("已配置 waker / 显式关闭 → 不跑也不落抢占记录", async () => {
    for (const key of [SIGNING_KEY, "false"]) {
      const { env, db } = await initializedContext({ WAKER_SIGNING_KEY: key })
      await worker.scheduled({} as never, env, {} as never)
      const row = db.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${countersTable(activePrefix(env))} WHERE action = 'scheduled_tick'`
        )
        .get() as { n: number }
      expect(row.n).toBe(0)
    }
  })

  it("未初始化数据库时 scheduled 不抛错（只记日志）", async () => {
    const { env } = makeContext()
    await expect(
      worker.scheduled({} as never, env, {} as never)
    ).resolves.toBeUndefined()
  })
})
