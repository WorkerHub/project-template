/**
 * 规格 §7-1（另一半）：CI 侧三态注入与运行时解析必须同值同规则。
 * scripts/resolve-table-prefix.mjs 与 src/lib/table-prefix.ts 是两份实现，
 * 改任何一边这条测试先红。
 */
import { describe, expect, it } from "vitest"
import {
  DEFAULT_TABLE_PREFIX as CI_DEFAULT,
  NO_PREFIX_KEYWORD,
  isUsablePrefix,
  resolveForCi
} from "../../scripts/resolve-table-prefix.mjs"
import { DEFAULT_TABLE_PREFIX } from "../src/config/project"
import { getTablePrefix, isValidTablePrefix } from "../src/lib/table-prefix"

/** CI 注入 wrangler [vars] 的值，最终由运行时解析成生效前缀。 */
function effectiveFromCi(raw: string | undefined): string {
  return getTablePrefix({ TABLE_PREFIX: resolveForCi(raw) })
}

describe("默认前缀常量两边同值", () => {
  it("CI 与运行时的 DEFAULT_TABLE_PREFIX 一致", () => {
    expect(CI_DEFAULT).toBe(DEFAULT_TABLE_PREFIX)
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
      "template_",
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
