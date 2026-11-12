/**
 * 部署前置（规格 §8）：把 GitHub Secrets / Variables 翻成两样东西——
 *   1. $RUNNER_TEMP/secrets.json（0600），交给 `wrangler deploy --secrets-file`
 *   2. 已解析的 worker/wrangler.toml（占位符替换 + 注入 [vars] TABLE_PREFIX）
 *
 * 真实值只来自 CI 的 secrets / vars，绝不进仓库、绝不打印：资源 ID 与密钥走
 * secrets（GitHub 自动掩码，无需 add-mask），D1_DATABASE_NAME 与 TABLE_PREFIX 走
 * variables。任何一把缺失、为空或仍是占位值，立即中止并点名是哪一把——绝不用
 * 空值或占位值顶替。TABLE_PREFIX 三态复用 scripts/resolve-table-prefix.mjs，不重写。
 *
 * 写入顺序：先在内存里把两样东西算好并校验完（含 wrangler.toml 占位符残留检查），
 * 再落盘——任何一处不合格都不留半成品。
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { isUsablePrefix, resolveForCi } from "./resolve-table-prefix.mjs"

if (!process.env.RUNNER_TEMP) {
  console.error("RUNNER_TEMP is not set")
  process.exit(1)
}

/**
 * 占位值判定：`*_PLACEHOLDER` 后缀，以及仓库模板里出现过的 `replace-with-…` 写法。
 * 模板值一旦被原样粘进 Secrets，必须和"没填"同等对待——否则会用公开已知的值上线。
 */
const isPlaceholder = (value) => {
  const v = value.trim()
  return /_PLACEHOLDER$/.test(v) || /^replace-with/i.test(v)
}

/** 必填项：键名 → 该配在哪。前两把会上传为 Worker secret。 */
const REQUIRED = [
  ["SETUP_SECRET", "repository secret"],
  ["SIGNING_SECRET", "repository secret"],
  ["CLOUDFLARE_API_TOKEN", "organization secret"],
  ["CLOUDFLARE_ACCOUNT_ID", "organization secret"],
  ["D1_DATABASE_ID", "organization secret"],
  ["D1_DATABASE_NAME", "organization variable"]
]

/** 上传给 Worker 运行时的项：setup 令牌 + tempToken / 验证码签名钥。 */
const SECRET_KEYS = ["SETUP_SECRET", "SIGNING_SECRET"]

/**
 * 可选项 `WAKER_SIGNING_KEY`：waker 回调的签名钥（规格 §5.5A 的三态开关）。
 * 未配置/占位值 = 未配置，不写进 secrets.json；保留值 `false` 是合法配置值
 * （= 显式关闭），必须原样上传，运行时要看到这个字面值才知道该停。
 */
const OPTIONAL_SECRET_KEYS = ["WAKER_SIGNING_KEY"]

/** 与运行时/方案同口径的"显式关闭"保留值（大小写敏感，只认小写）。 */
const WAKER_SIGNING_KEY_DISABLED = "false"

const config = {}
const problems = []
for (const [name, where] of REQUIRED) {
  const raw = process.env[name]
  const value = typeof raw === "string" ? raw.trim() : ""
  if (value === "") {
    problems.push(`${name} 未配置（应放在 ${where}）`)
    continue
  }
  if (isPlaceholder(value)) {
    problems.push(`${name} 仍是占位值（应放在 ${where}）`)
    continue
  }
  config[name] = value
}
if (problems.length > 0) {
  for (const line of problems) console.error(line)
  console.error(
    "配置不全，已中止：不会生成 secrets.json，也不会改动 wrangler.toml。"
  )
  process.exit(1)
}

// ─── 1. TABLE_PREFIX 三态（解析与校验复用根脚本的同一实现）────────────────
const tablePrefix = resolveForCi(process.env.TABLE_PREFIX)
if (!isUsablePrefix(tablePrefix)) {
  console.error(
    `TABLE_PREFIX 非法（空值表示无前缀；非空时须以字母或下划线开头，其后只允许字母、数字、下划线）：${JSON.stringify(tablePrefix)}。请修正 GitHub Variables 中的 TABLE_PREFIX。`
  )
  console.error("已中止：不会生成 secrets.json，也不会改动 wrangler.toml。")
  process.exit(1)
}

// ─── 2. wrangler.toml 占位符替换（仍在内存里，先不落盘）────────────────────
const wranglerPath = fileURLToPath(
  new URL("../worker/wrangler.toml", import.meta.url)
)
let toml = readFileSync(wranglerPath, "utf8")

const replacements = {
  CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER: config.CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_NAME_PLACEHOLDER: config.D1_DATABASE_NAME,
  D1_DATABASE_ID_PLACEHOLDER: config.D1_DATABASE_ID
}
for (const [placeholder, value] of Object.entries(replacements)) {
  toml = toml.replaceAll(placeholder, value)
}

// 本地重复跑本脚本时去掉上一次追加的 [vars]，避免叠加。
// 只匹配脚本自己追加的那一段（文件末尾的注释里也出现过 "[vars]" 字样）。
toml = toml.replace(/\n\[vars\]\nTABLE_PREFIX = .*\n?$/, "")
if (!toml.endsWith("\n")) toml += "\n"
toml += `\n[vars]\nTABLE_PREFIX = ${JSON.stringify(tablePrefix)}\n`

if (toml.includes("_PLACEHOLDER")) {
  console.error(
    "wrangler.toml 仍残留未替换的占位符，已中止：不会生成 secrets.json，也不会部署。"
  )
  process.exit(1)
}

// ─── 3. 落盘：secrets.json（0600）+ wrangler.toml ──────────────────────────
const secrets = {}
for (const key of SECRET_KEYS) secrets[key] = config[key]

const optional = []
for (const name of OPTIONAL_SECRET_KEYS) {
  const raw = process.env[name]
  const value = typeof raw === "string" ? raw.trim() : ""
  if (value === "" || isPlaceholder(value)) {
    console.log(`${name}: 未配置`)
    continue
  }
  secrets[name] = value
  optional.push(name)
  console.log(
    value === WAKER_SIGNING_KEY_DISABLED ? `${name}: 已关闭` : `${name}: 已配置`
  )
}

const secretsPath = `${process.env.RUNNER_TEMP}/secrets.json`
// mode 只在创建时生效，先删掉可能残留的旧文件，保证 0600 真正落实。
rmSync(secretsPath, { force: true })
writeFileSync(secretsPath, JSON.stringify(secrets), { mode: 0o600 })
writeFileSync(wranglerPath, toml)

// 日志只暴露键名与非机密的表前缀，绝不打印任何密钥/资源 ID 的值。
console.log(
  `secrets.json 已写入（${[...SECRET_KEYS, ...optional].join(", ")}，权限 0600）`
)
console.log(
  `wrangler.toml 已解析（已注入 account_id / D1 名称与 ID；TABLE_PREFIX=${JSON.stringify(tablePrefix)}）`
)
