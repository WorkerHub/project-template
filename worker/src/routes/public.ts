/**
 * 公开引导端点（规格 §5.5）：只有站点名、一句话说明、仓库地址、版本号与几个
 * 公开开关。可缓存 60 秒——它不含任何私有字段，也不读用户会话。
 */
import { Hono } from "hono"
import { buildPublicBootstrap } from "../lib/settings"
import type { HonoEnv } from "../types"

export const publicRoutes = new Hono<HonoEnv>()

publicRoutes.get("/", async (c) => {
  c.header("Cache-Control", "public, max-age=60")
  return c.json(await buildPublicBootstrap(c.env))
})
