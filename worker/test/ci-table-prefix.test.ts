/**
 * 规格 §7-1（另一半）：CI 侧三态注入与运行时解析必须同值同规则。
 *
 * 默认前缀只有一份值（worker/src/config/defaults.json），CI 与运行时都从它派生；
 * 转换/校验仍是两份实现，其等价性由本文件锁住：改任何一边，这里的测试先红。
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_TABLE_PREFIX as CI_DEFAULT,
  NO_PREFIX_KEYWORD,
  isUsablePrefix,
  resolveForCi
} from "../../scripts/resolve-table-prefix.mjs"
import defaults from "../src/config/defaults.json"
import { DEFAULT_TABLE_PREFIX } from "../src/config/project"
import { getTablePrefix, isValidTablePrefix } from "../src/lib/table-prefix"

/** CI 注入 wrangler [vars] 的值，最终由运行时解析成生效前缀。 */
function effectiveFromCi(raw: string | undefined): string {
  return getTablePrefix({ TABLE_PREFIX: resolveForCi(raw) })
}

describe("默认前缀只有一份真源：worker/src/config/defaults.json", () => {
  it("共享配置本身是合法的非空前缀", () => {
    expect(defaults.defaultTablePrefix).not.toBe("")
    expect(isUsablePrefix(defaults.defaultTablePrefix)).toBe(true)
  })

  it("CI 与运行时都从共享配置派生", () => {
    expect(CI_DEFAULT).toBe(defaults.defaultTablePrefix)
    expect(DEFAULT_TABLE_PREFIX).toBe(defaults.defaultTablePrefix)
  })

  it("两份实现的源码里不再写死默认前缀字面量", () => {
    for (const relative of [
      "../../scripts/resolve-table-prefix.mjs",
      "../src/config/project.ts"
    ]) {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8")
      expect(source).not.toMatch(/DEFAULT_TABLE_PREFIX\s*=\s*"/)
    }
  })

  it("“无前缀”保留字是 none", () => {
    expect(NO_PREFIX_KEYWORD).toBe("none")
  })
})

describe("GitHub Variables → 生效前缀", () => {
  it("未设置 / 空串 → 默认前缀", () => {
    expect(effectiveFromCi(undefined)).toBe(`${DEFAULT_TABLE_PREFIX}_`)
    expect(effectiveFromCi("")).toBe(`${DEFAULT_TABLE_PREFIX}_`)
  })

  it("保留字 none → 无前缀", () => {
    expect(resolveForCi("none")).toBe("")
    expect(effectiveFromCi("none")).toBe("")
  })

  it("自定义值原样注入，运行时补尾下划线", () => {
    expect(resolveForCi("wiki")).toBe("wiki")
    expect(effectiveFromCi("wiki")).toBe("wiki_")
    expect(effectiveFromCi("wiki_")).toBe("wiki_")
  })

  it("大写 NONE 不当作保留字", () => {
    expect(effectiveFromCi("NONE")).toBe("NONE_")
  })
})

describe("前缀校验两边同规则", () => {
  it("接受/拒绝同一批值", () => {
    const samples = [
      "",
      `${DEFAULT_TABLE_PREFIX}_`,
      "wiki",
      "_shared",
      "2026",
      "1abc",
      "my-prefix",
      "my prefix"
    ]
    for (const sample of samples) {
      expect(isUsablePrefix(sample)).toBe(isValidTablePrefix(sample))
    }
  })
})
