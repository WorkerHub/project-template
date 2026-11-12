/**
 * 部署前置脚本（scripts/materialize-secrets.mjs）的端到端测试：在临时目录里复制
 * 一份真实脚本 + wrangler.toml 再跑，不碰仓库里的文件。
 *
 * 覆盖：TABLE_PREFIX 三态注入、secrets.json 的 0600 与运行时两把钥、可选
 * WAKER_SIGNING_KEY 的三态，以及"缺键 / 空值 / 占位值 / 占位符残留 / 非法前缀
 * 一律中止且不留半成品、日志不含任何配置值"。
 */
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
const scriptName = "materialize-secrets.mjs"
const resolverName = "resolve-table-prefix.mjs"
const wranglerToml = readFileSync(
  path.join(repoRoot, "worker", "wrangler.toml"),
  "utf8"
)

const VALID_ENV = {
  SETUP_SECRET: "setup-token-unit-test",
  SIGNING_SECRET: "signing-token-unit-test",
  CLOUDFLARE_API_TOKEN: "cf-api-token-unit-test",
  CLOUDFLARE_ACCOUNT_ID: "acct-unit-test",
  D1_DATABASE_ID: "dbid-unit-test",
  D1_DATABASE_NAME: "workerhub-app"
}

/** 建一个"仓库副本"：scripts/ 下两个真实脚本 + worker/wrangler.toml。 */
function makeSandbox(toml = wranglerToml) {
  const dir = mkdtempSync(path.join(tmpdir(), "materialize-secrets-"))
  mkdirSync(path.join(dir, "scripts"))
  mkdirSync(path.join(dir, "worker"))
  copyFileSync(
    path.join(repoRoot, "scripts", resolverName),
    path.join(dir, "scripts", resolverName)
  )
  copyFileSync(
    path.join(repoRoot, "scripts", scriptName),
    path.join(dir, "scripts", scriptName)
  )
  writeFileSync(path.join(dir, "worker", "wrangler.toml"), toml)
  return dir
}

type RunResult = {
  status: number | null
  stdout: string
  stderr: string
  secretsPath: string
  toml: string
}

/** 跑一次脚本，返回退出码、输出、secrets.json 位置与跑完后的 toml。 */
function runScript(
  dir: string,
  env: Record<string, string | undefined>
): RunResult {
  const runnerTemp = mkdtempSync(path.join(tmpdir(), "runner-temp-"))
  const childEnv: Record<string, string> = { PATH: process.env.PATH ?? "" }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value
  }
  childEnv.RUNNER_TEMP = runnerTemp

  const res = spawnSync(
    process.execPath,
    [path.join(dir, "scripts", scriptName)],
    { env: childEnv, encoding: "utf8" }
  )

  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    secretsPath: path.join(runnerTemp, "secrets.json"),
    toml: readFileSync(path.join(dir, "worker", "wrangler.toml"), "utf8")
  }
}

function exists(filePath: string): boolean {
  try {
    statSync(filePath)
    return true
  } catch {
    return false
  }
}

const varsBlock = (toml: string) =>
  toml.match(/\[vars\]\nTABLE_PREFIX = (.*)\n/)?.[1]

const secretKeys = (secretsPath: string): string[] =>
  Object.keys(JSON.parse(readFileSync(secretsPath, "utf8")) as object)

describe("materialize-secrets：三态注入与落盘", () => {
  it("未设置 TABLE_PREFIX → 注入 template，secrets.json 为 0600 且含两把运行时钥", () => {
    const res = runScript(makeSandbox(), VALID_ENV)

    expect(res.status).toBe(0)
    expect(varsBlock(res.toml)).toBe('"template"')
    expect(exists(res.secretsPath)).toBe(true)
    expect(statSync(res.secretsPath).mode & 0o777).toBe(0o600)
    expect(secretKeys(res.secretsPath)).toEqual([
      "SETUP_SECRET",
      "SIGNING_SECRET"
    ])
    // 占位符全部被替换，且不再有残留
    expect(res.toml).not.toContain("_PLACEHOLDER")
    expect(res.toml).toContain('account_id = "acct-unit-test"')
    expect(res.toml).toContain('database_name = "workerhub-app"')
    expect(res.toml).toContain('database_id = "dbid-unit-test"')
  })

  it("TABLE_PREFIX 为空串 → 注入 template（与未设置等价）", () => {
    const res = runScript(makeSandbox(), { ...VALID_ENV, TABLE_PREFIX: "" })

    expect(res.status).toBe(0)
    expect(varsBlock(res.toml)).toBe('"template"')
  })

  it("TABLE_PREFIX=none → 注入空串（无前缀）", () => {
    const res = runScript(makeSandbox(), {
      ...VALID_ENV,
      TABLE_PREFIX: "none"
    })

    expect(res.status).toBe(0)
    expect(varsBlock(res.toml)).toBe('""')
  })

  it("自定义前缀原样注入（补尾下划线留给运行时）", () => {
    const res = runScript(makeSandbox(), {
      ...VALID_ENV,
      TABLE_PREFIX: "wiki"
    })

    expect(res.status).toBe(0)
    expect(varsBlock(res.toml)).toBe('"wiki"')
  })

  it("重复跑不会叠加 [vars] 段", () => {
    const dir = makeSandbox()
    runScript(dir, { ...VALID_ENV, TABLE_PREFIX: "wiki" })
    const res = runScript(dir, { ...VALID_ENV, TABLE_PREFIX: "wiki" })

    expect(res.status).toBe(0)
    // 只数真正的段头行；文件注释里也出现过 "[vars]" 字样。
    expect(res.toml.match(/^\[vars\]$/gm)).toHaveLength(1)
    expect(varsBlock(res.toml)).toBe('"wiki"')
  })

  it("日志只含键名与非机密前缀，不含任何配置值", () => {
    const res = runScript(makeSandbox(), { ...VALID_ENV, TABLE_PREFIX: "wiki" })
    const output = res.stdout + res.stderr

    expect(res.status).toBe(0)
    expect(output).toContain("SETUP_SECRET, SIGNING_SECRET")
    expect(output).toContain('TABLE_PREFIX="wiki"')
    for (const value of [
      VALID_ENV.SETUP_SECRET,
      VALID_ENV.SIGNING_SECRET,
      VALID_ENV.CLOUDFLARE_API_TOKEN,
      VALID_ENV.CLOUDFLARE_ACCOUNT_ID,
      VALID_ENV.D1_DATABASE_ID,
      VALID_ENV.D1_DATABASE_NAME
    ]) {
      expect(output).not.toContain(value)
    }
  })
})

describe("materialize-secrets：不合格配置一律中止且不留半成品", () => {
  it("缺 SETUP_SECRET → 退出 1、点名、不生成 secrets.json、不改 toml", () => {
    const dir = makeSandbox()
    const res = runScript(dir, { ...VALID_ENV, SETUP_SECRET: undefined })

    expect(res.status).toBe(1)
    expect(res.stderr).toContain("SETUP_SECRET")
    expect(exists(res.secretsPath)).toBe(false)
    expect(res.toml).toBe(wranglerToml)
  })

  it("缺 SIGNING_SECRET → 与缺 SETUP_SECRET 同级处理", () => {
    const dir = makeSandbox()
    const res = runScript(dir, { ...VALID_ENV, SIGNING_SECRET: undefined })

    expect(res.status).toBe(1)
    expect(res.stderr).toContain("SIGNING_SECRET")
    expect(exists(res.secretsPath)).toBe(false)
    expect(res.toml).toBe(wranglerToml)
  })

  it("缺资源 ID / 名称 / 令牌 → 点名对应键", () => {
    for (const [key, where] of [
      ["CLOUDFLARE_API_TOKEN", "organization secret"],
      ["CLOUDFLARE_ACCOUNT_ID", "organization secret"],
      ["D1_DATABASE_ID", "organization secret"],
      ["D1_DATABASE_NAME", "organization variable"]
    ] as const) {
      const res = runScript(makeSandbox(), { ...VALID_ENV, [key]: undefined })

      expect(res.status).toBe(1)
      expect(res.stderr).toContain(key)
      expect(res.stderr).toContain(where)
      expect(exists(res.secretsPath)).toBe(false)
    }
  })

  it("空值视为未配置", () => {
    const res = runScript(makeSandbox(), { ...VALID_ENV, SETUP_SECRET: "" })

    expect(res.status).toBe(1)
    expect(res.stderr).toContain("SETUP_SECRET")
    expect(exists(res.secretsPath)).toBe(false)
  })

  it("模板值（*_PLACEHOLDER / replace-with-*）按未填写处理", () => {
    for (const [key, template] of [
      ["SETUP_SECRET", "SETUP_SECRET_PLACEHOLDER"],
      ["SIGNING_SECRET", "replace-with-a-long-random-string"]
    ] as const) {
      const res = runScript(makeSandbox(), { ...VALID_ENV, [key]: template })

      expect(res.status).toBe(1)
      expect(res.stderr).toContain(key)
      expect(exists(res.secretsPath)).toBe(false)
    }
  })

  it("非法前缀（2026 / app-x）→ 退出 1、不改 wrangler.toml、不生成 secrets.json", () => {
    for (const badPrefix of ["2026", "app-x"]) {
      const dir = makeSandbox()
      const res = runScript(dir, { ...VALID_ENV, TABLE_PREFIX: badPrefix })

      expect(res.status).toBe(1)
      expect(res.toml).toBe(wranglerToml)
      expect(exists(res.secretsPath)).toBe(false)
    }
  })

  it("wrangler.toml 残留占位符时先中止，绝不先生成 secrets.json", () => {
    const withLeftover = `${wranglerToml}\n# fixture\nSOMETHING_PLACEHOLDER = "x"\n`
    const res = runScript(makeSandbox(withLeftover), VALID_ENV)

    expect(res.status).toBe(1)
    expect(res.stderr).toContain("占位符")
    expect(exists(res.secretsPath)).toBe(false)
    expect(res.toml).toBe(withLeftover)
  })
})

describe("materialize-secrets：可选的 WAKER_SIGNING_KEY", () => {
  it("未配置 → 不写进 secrets.json，部署照常成功", () => {
    const res = runScript(makeSandbox(), VALID_ENV)

    expect(res.status).toBe(0)
    expect(secretKeys(res.secretsPath)).toEqual([
      "SETUP_SECRET",
      "SIGNING_SECRET"
    ])
    expect(res.stdout).toContain("WAKER_SIGNING_KEY: 未配置")
  })

  it("已配置 → 注入 secrets.json 且日志绝不打印值", () => {
    const res = runScript(makeSandbox(), {
      ...VALID_ENV,
      WAKER_SIGNING_KEY: "waker-key-unit-test"
    })

    expect(res.status).toBe(0)
    const secrets = JSON.parse(readFileSync(res.secretsPath, "utf8")) as Record<
      string,
      string
    >
    expect(secrets.WAKER_SIGNING_KEY).toBe("waker-key-unit-test")
    expect(secretKeys(res.secretsPath)).toEqual([
      "SETUP_SECRET",
      "SIGNING_SECRET",
      "WAKER_SIGNING_KEY"
    ])
    expect(res.stdout).toContain("WAKER_SIGNING_KEY: 已配置")
    expect(res.stdout + res.stderr).not.toContain("waker-key-unit-test")
  })

  it("占位值一律按未配置处理", () => {
    const res = runScript(makeSandbox(), {
      ...VALID_ENV,
      WAKER_SIGNING_KEY: "WAKER_SIGNING_KEY_PLACEHOLDER"
    })

    expect(res.status).toBe(0)
    expect(secretKeys(res.secretsPath)).not.toContain("WAKER_SIGNING_KEY")
    expect(res.stdout).toContain("WAKER_SIGNING_KEY: 未配置")
  })

  it("false（显式关闭）是合法值：照常写进 secrets.json", () => {
    const res = runScript(makeSandbox(), {
      ...VALID_ENV,
      WAKER_SIGNING_KEY: "false"
    })

    expect(res.status).toBe(0)
    const secrets = JSON.parse(readFileSync(res.secretsPath, "utf8")) as Record<
      string,
      string
    >
    expect(secrets.WAKER_SIGNING_KEY).toBe("false")
    expect(res.stdout).toContain("WAKER_SIGNING_KEY: 已关闭")
  })
})
