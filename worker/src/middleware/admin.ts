/**
 * 管理员闸（规格 §5.3.5、§6.1）：挂在会话中间件之后，`role !== "admin"` 一律 403。
 * 前端隐藏菜单只是体验，服务端 403 才是边界。
 */
import type { Context, Next } from "hono"
import type { HonoEnv } from "../types"

export async function adminMiddleware(c: Context<HonoEnv>, next: Next) {
  if (c.get("role") !== "admin") {
    c.header("Cache-Control", "no-store")
    return c.json({ error: "Forbidden" }, 403)
  }
  await next()
}
