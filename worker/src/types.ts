/**
 * Worker 的运行期绑定与密钥。密钥只来自 wrangler secrets：
 * 线上由 CI 经 `wrangler deploy --secrets-file` 上传，本地来自 worker/.dev.vars
 * （见 worker/.dev.vars.example，已被 gitignore）。
 */
export interface Env {
  /** 运行库（D1）：表名一律经 getTablePrefix() 拼前缀。 */
  DB: D1Database
  /** Workers Static Assets：前端构建产物 web/dist。 */
  ASSETS: Fetcher
  /** setup / 数据库维护的 X-Setup-Secret 令牌（仓库级 secret）。 */
  SETUP_SECRET?: string
  /**
   * 表前缀三态，解析见 src/lib/table-prefix.ts 的 getTablePrefix()：
   * 未设置 → 项目默认前缀（"template_"）；自定义值 → 补尾 "_"；"" → 无前缀。
   * 部署期由 scripts/materialize-secrets.mjs 注入，不在仓库里写死。
   */
  TABLE_PREFIX?: string
}

/** 请求级上下文：会话中间件解析出来的身份，供路由读取。 */
export interface Variables {
  userId: number
  role: string
  sessionId: string
}

export type HonoEnv = { Bindings: Env; Variables: Variables }
