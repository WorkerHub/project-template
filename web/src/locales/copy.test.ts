import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 界面文案守卫（规格 §6.5）：组件源码里不许出现写死的中文文案，
 * 全部走 locales 的 i18n key。注释里的中文不算（本仓注释就是中文）。
 *
 * 只扫 `web/src` 下的 .ts/.tsx，排除 locales 与测试文件；扫描前先去掉
 * 字符串与注释——字符串会保留在原文里，所以中文字面量仍会被抓到。
 */

const ROOT = path.resolve(process.cwd(), "src")
const CJK = /[\u4e00-\u9fff]/

function stripComments(source: string): string {
  let output = ""
  let index = 0
  let quote: string | null = null

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (quote) {
      output += char
      if (char === "\\") {
        output += next ?? ""
        index += 2
        continue
      }
      if (char === quote) quote = null
      index += 1
      continue
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char
      output += char
      index += 1
      continue
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1
      continue
    }

    if (char === "/" && next === "*") {
      index += 2
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1
      }
      index += 2
      continue
    }

    output += char
    index += 1
  }

  return output
}

function collect(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "locales") continue
      collect(full, files)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (/\.test\.(ts|tsx)$/.test(entry)) continue
    if (full.includes(`${path.sep}test${path.sep}`)) continue
    files.push(full)
  }
  return files
}

describe("界面文案", () => {
  it("组件源码里没有硬编码的中文文案", () => {
    const offenders: string[] = []
    for (const file of collect(ROOT)) {
      const source = stripComments(readFileSync(file, "utf8"))
      source.split("\n").forEach((line, index) => {
        if (CJK.test(line)) {
          offenders.push(
            `${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`
          )
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
