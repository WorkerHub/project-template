/**
 * Worker 入口：路由挂载 + 全局守卫 + SPA 回落。
 *
 * 本单只挂 setup 与系统管理的数据库维护入口；鉴权、公开数据、邮件等路由由
 * 后续单按同一套中间件补齐——它们直接复用这里的会话中间件、no-store 与
 * 公开白名单机制，不需要另起一套。
 */
import { Hono } from "hono"
import { getTablePrefix, isValidTablePrefix } from "./lib/table-prefix"
import { authMiddleware } from "./middleware/auth"
import { adminRoutes } from "./routes/admin"
import { setupRoutes } from "./routes/setup"
import type { Env, HonoEnv } from "./types"

export const app = new Hono<HonoEnv>()

// 前缀是拼进 SQL 标识符的配置，非法即全站 fail closed：宁可 500，也不拿畸形
// 前缀建表/查表。日志只说明原因，不回显配置值。
app.use("*", async (c, next) => {
  const prefix = getTablePrefix(c.env)
  if (!isValidTablePrefix(prefix)) {
    console.error(
      "TABLE_PREFIX 配置非法：空值表示无前缀；非空时须以字母或下划线开头，其后只允许字母、数字、下划线"
    )
    return c.json({ error: "Invalid TABLE_PREFIX configuration" }, 500)
  }
  await next()
})

// 未登录/敏感响应一律 no-store；路由自己设了缓存头的保留它自己的。
app.use("/api/*", async (c, next) => {
  await next()
  if (!c.res.headers.has("cache-control")) {
    c.res.headers.set("cache-control", "no-store")
  }
})

/**
 * 公开路径（方法 + 路径精确匹配）。setup 整段公开：state 是公开状态端点，
 * POST 只认请求头密钥，其余方法由 setup 路由自己回 405 JSON。
 */
const PUBLIC_ROUTES = new Set(["GET /api/health"])

function isPublicRoute(method: string, path: string): boolean {
  if (path === "/api/setup" || path.startsWith("/api/setup/")) return true
  return PUBLIC_ROUTES.has(`${method} ${path}`)
}

// 公开路径之外，全部要会话。
app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (isPublicRoute(c.req.method, path)) {
    await next()
    return
  }
  return authMiddleware(c, next)
})

app.route("/api/setup", setupRoutes)
app.route("/api/admin", adminRoutes)

// 存活探针。生效前缀不在这里暴露——它只经 setup / 管理面的接口回显。
app.get("/api/health", (c) => c.json({ status: "ok" }))

// 未命中的 API 一律 JSON 404：不能落到下面的 SPA 回落，否则调用方会把
// "接口不存在"当成 200 的 HTML 页面。
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404))

// SPA 回落：静态资源命中就直接返回，未命中（客户端路由）返回 index.html。
app.get("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw)
  if (res.status !== 404) return res
  return c.env.ASSETS.fetch(new Request(new URL("/", c.req.url), c.req.raw))
})

app.onError((err, c) => {
  console.error(
    "Unhandled error:",
    err instanceof Error ? err.message : String(err)
  )
  if (err instanceof SyntaxError) {
    return c.json({ error: "Invalid request body" }, 400)
  }
  return c.json({ error: "Internal server error" }, 500)
})

export default {
  fetch: app.fetch
} satisfies ExportedHandler<Env>
