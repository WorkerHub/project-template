/**
 * 系统管理接口（本单只有数据库维护按钮的入口）。
 *
 * `POST /setup`：会话 + 管理员双层鉴权，免密钥；动作与回显与密钥面
 * （POST /api/setup）完全一致——两处调同一个 runSetup，回显同一个形状。
 * 绝不允许出现删表/清库/重初始化入口。
 */
import { Hono } from "hono"
import { runSetup } from "../lib/setup"
import { adminMiddleware } from "../middleware/admin"
import type { HonoEnv } from "../types"

export const adminRoutes = new Hono<HonoEnv>()

adminRoutes.use("*", adminMiddleware)

adminRoutes.post("/setup", async (c) => {
  try {
    const result = await runSetup(c.env)
    return c.json(result, result.success ? 200 : 409)
  } catch (err) {
    console.error(
      "Admin setup failed:",
      err instanceof Error ? err.message : err
    )
    return c.json({ error: "Setup failed" }, 500)
  }
})
