/**
 * 路由层共用的小工具：客户端 IP、秒级时间、统一的 JSON 错误形状。
 *
 * 错误一律 `{error, code}`（需要时再带 `retryAfter` / `detail`）。`code` 是稳定
 * 契约，前端按它翻译；`error` 是英文排障说明，绝不把中文文案直出到英文界面
 * （规格 §6.5）。
 */
import type { Context } from "hono"
import type { HonoEnv } from "../types"

/** 错误响应可能用到的状态码（Hono 要求 ContentfulStatusCode）。 */
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503

export function clientIp(c: Context<HonoEnv>): string {
  const forwarded = c.req.header("x-forwarded-for")
  return (
    c.req.header("cf-connecting-ip") ||
    (forwarded ? forwarded.split(",")[0].trim() : "") ||
    "unknown"
  )
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function apiError(
  c: Context<HonoEnv>,
  status: ApiErrorStatus,
  code: string,
  error: string,
  extra?: Record<string, unknown>
): Response {
  c.header("Cache-Control", "no-store")
  return c.json({ error, code, ...(extra ?? {}) }, status)
}

export function rateLimited(c: Context<HonoEnv>, retryAfter: number): Response {
  return apiError(c, 429, "RATE_LIMITED", "Too many requests", { retryAfter })
}

export async function readJsonBody<T>(c: Context<HonoEnv>): Promise<T | null> {
  return c.req.json<T>().catch(() => null)
}
