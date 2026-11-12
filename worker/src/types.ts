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
   * 服务端签名钥：两步登录 tempToken、通行密钥挑战 Cookie、验证码哈希共用。
   * 与 SETUP_SECRET 分开、绝不复用；缺失时需签名的端点失败关闭
   * （见 core/auth.ts 的 isSigningSecretConfigured），部署期由
   * scripts/materialize-secrets.mjs 校验，缺失则不生成 secrets.json。
   */
  SIGNING_SECRET?: string
  /** waker 接入的唯一开关（三态，见 core/waker-gate.ts）：不配 → 原生 Cron。 */
  WAKER_SIGNING_KEY?: string
  /** 构建期注入的版本号（§6.3），只经 /api/public 暴露；不写死在前端。 */
  APP_VERSION?: string
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
