/**
 * 项目身份令牌校验（规格 §4）：从模板生成新项目后，改名成本收敛到一处 + 一份清单。
 *
 * 身份单点是 worker/src/config/project.ts；令牌只允许出现在下面 ALLOWED 列出的
 * 位置。生成新项目后把这几处的令牌改掉、再跑 `pnpm check:identity`，全仓扫描
 * 零残留才算改完。
 *
 * 用法：pnpm check:identity（退出码 0 = 通过，1 = 有残留或有位置没改到）。
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const CONFIG_PATH = "worker/src/config/project.ts"

/** 身份令牌唯一允许出现的位置（规格 §4 的令牌清单）。 */
const ALLOWED = new Set([
  CONFIG_PATH,
  // 只放默认表前缀这类默认值，不放身份令牌；列入白名单是为了生成项目的
  // slug 恰好与默认前缀同串时，全仓扫描不误报。
  "worker/src/config/defaults.json",
  "package.json",
  "web/package.json",
  "worker/wrangler.toml",
  "web/index.html",
  "README.md"
])

/** 二进制文件不做文本扫描。 */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".pdf",
  ".zip",
  ".gz"
])

const root = path.resolve(import.meta.dirname, "..")
const problems = []

function fail(message) {
  problems.push(message)
}

function readConfigString(key) {
  const source = readFileSync(path.join(root, CONFIG_PATH), "utf8")
  const matched = source.match(
    new RegExp(`export const ${key}\\s*=\\s*"([^"]*)"`)
  )
  if (!matched?.[1]) {
    fail(`${CONFIG_PATH}: 读不到 ${key}（身份单点必须导出非空字符串）`)
    return ""
  }
  return matched[1]
}

function readFile(relative) {
  try {
    return readFileSync(path.join(root, relative), "utf8")
  } catch {
    return null
  }
}

function expectMatch(relative, pattern, expectation) {
  const content = readFile(relative)
  if (content === null) {
    fail(`${relative}: 文件不存在`)
    return
  }
  const matched = content.match(pattern)
  if (!matched) {
    fail(`${relative}: 没找到 ${expectation}`)
  } else if (matched[1] !== expectation) {
    fail(`${relative}: 期望 "${expectation}"，实际 "${matched[1]}"`)
  }
}

const projectName = readConfigString("PROJECT_NAME")
const projectSlug = readConfigString("PROJECT_SLUG")

if (projectName && projectSlug) {
  // 各令牌位置必须真的改成当前身份，否则"改名只改一半"也能悄悄通过。
  expectMatch("package.json", /"name":\s*"([^"]+)"/, projectSlug)
  expectMatch("web/package.json", /"name":\s*"([^"]+)"/, `${projectSlug}-web`)
  expectMatch("worker/wrangler.toml", /^name\s*=\s*"([^"]+)"/m, projectSlug)

  const indexHtml = readFile("web/index.html")
  if (!indexHtml?.includes(`<title>${projectName}</title>`)) {
    fail(`web/index.html: <title> 必须是 "${projectName}"`)
  }

  const readme = readFile("README.md")
  if (!(readme?.includes(projectName) || readme?.includes(projectSlug))) {
    fail("README.md: 标题或说明里必须出现当前项目名")
  }

  // 全仓扫描：白名单之外出现令牌就是没改完。
  // 已跟踪 + 未跟踪但未被忽略的文件一起扫：生成新项目后常在提交前就跑这条命令。
  const tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      encoding: "utf8"
    }
  )
    .split("\n")
    .filter(Boolean)

  const tokens = [...new Set([projectName, projectSlug])]
  for (const relative of tracked) {
    if (ALLOWED.has(relative)) continue
    if (BINARY_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue
    const content = readFile(relative)
    if (content === null) continue
    const lines = content.split("\n")
    for (let index = 0; index < lines.length; index++) {
      for (const token of tokens) {
        if (token && lines[index].includes(token)) {
          fail(
            `${relative}:${index + 1}: 出现项目身份令牌 "${token}"，请改用身份单点或删掉`
          )
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error("身份令牌校验未通过：")
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(
  `身份令牌校验通过：项目名 "${projectName}"，仓库/Worker 名 "${projectSlug}"，白名单外零残留。`
)
