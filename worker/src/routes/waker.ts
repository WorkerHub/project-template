/**
 * waker 回调入口（规格 §5.5A）：`POST /_waker/execute`。
 *
 * 走签名头而不是会话（不是 `/api/*`，不走会话中间件）；验签失败一律拒绝，
 * 签名钥未配置、或显式为保留值 `false` 时失败关闭（500 `signing_key_missing`）。
 * 验签通过后把任务交给 `services/scheduled-task.ts` 的 no-op 桩——与原生 Cron
 * 共用同一份实现，靠 D1 抢占避免双跑。
 */
import { Hono } from "hono"
import { wakerSigningKey } from "../core/waker-gate"
import {
  runScheduledTask,
  SCHEDULED_TASK_NAME
} from "../services/scheduled-task"
import { CALLBACK_HEADERS, verifyWakerSignature } from "../waker/verify"
import type { HonoEnv } from "../types"

export const wakerRoutes = new Hono<HonoEnv>()

wakerRoutes.post("/execute", async (c) => {
  const key = wakerSigningKey(c.env)
  if (!key) {
    return c.json(
      {
        ok: false,
        error: {
          code: "signing_key_missing",
          message:
            "WAKER_SIGNING_KEY is not configured (or set to the reserved value false)"
        }
      },
      500
    )
  }

  // 验签必须用未解析的原始请求体：重新序列化会改键序/空白，签名必然不匹配。
  const rawBody = await c.req.text()
  const timestamp = c.req.header(CALLBACK_HEADERS.timestamp) ?? ""
  const executionId = c.req.header(CALLBACK_HEADERS.executionId) ?? ""
  const jobId = c.req.header(CALLBACK_HEADERS.jobId) ?? ""
  const signature = c.req.header(CALLBACK_HEADERS.signature) ?? ""

  const verification = await verifyWakerSignature({
    secret: key,
    signature,
    timestamp,
    executionId,
    jobId,
    body: rawBody
  })
  if (!verification.ok) {
    const status =
      verification.reason === "bad_signature" ||
      verification.reason === "stale_timestamp"
        ? 401
        : 400
    const code =
      verification.reason === "stale_timestamp"
        ? "stale_timestamp"
        : verification.reason === "bad_signature"
          ? "invalid_signature"
          : "invalid_request"
    return c.json(
      { ok: false, error: { code, message: verification.reason } },
      status
    )
  }

  let body: {
    executionId?: unknown
    jobId?: unknown
    jobName?: unknown
  }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return c.json(
      {
        ok: false,
        error: { code: "invalid_request", message: "Body is not valid JSON" }
      },
      400
    )
  }
  if (body.executionId !== executionId || body.jobId !== jobId) {
    return c.json(
      {
        ok: false,
        error: {
          code: "invalid_request",
          message: "Body ids do not match the signed headers"
        }
      },
      400
    )
  }
  if (body.jobName !== SCHEDULED_TASK_NAME) {
    return c.json(
      {
        ok: false,
        error: {
          code: "unknown_job",
          message: `Unknown job; the only registered job is "${SCHEDULED_TASK_NAME}"`
        }
      },
      404
    )
  }

  try {
    const outcome = await runScheduledTask(c.env, { trigger: "waker" })
    return c.json({ ok: true, ...outcome })
  } catch (err) {
    console.error(
      "waker job failed:",
      err instanceof Error ? err.message : String(err)
    )
    return c.json(
      {
        ok: false,
        error: { code: "job_failed", message: "Job execution failed" }
      },
      500
    )
  }
})

// 其余方法与未知子路径：JSON 404，绝不落到 SPA 回落。
wakerRoutes.all("*", (c) =>
  c.json(
    { ok: false, error: { code: "invalid_request", message: "Not found" } },
    404
  )
)
