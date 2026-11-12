/**
 * 规格 §7-1（一半）：表前缀三态解析与合法性校验。
 */
import { describe, expect, it } from "vitest"
import { DEFAULT_TABLE_PREFIX } from "../src/config/project"
import {
  ensureTrailingUnderscore,
  getTablePrefix,
  isValidTablePrefix
} from "../src/lib/table-prefix"

const DEFAULT_PREFIX = `${DEFAULT_TABLE_PREFIX}_`

describe("TABLE_PREFIX 三态解析", () => {
  it("未配置（undefined / null）→ 默认前缀并补尾下划线", () => {
    expect(getTablePrefix({})).toBe(DEFAULT_PREFIX)
    expect(getTablePrefix({ TABLE_PREFIX: undefined })).toBe(DEFAULT_PREFIX)
    expect(getTablePrefix({ TABLE_PREFIX: null })).toBe(DEFAULT_PREFIX)
  })

  it("自定义值 → 补尾下划线，已带则原样", () => {
    expect(getTablePrefix({ TABLE_PREFIX: "wiki" })).toBe("wiki_")
    expect(getTablePrefix({ TABLE_PREFIX: "wiki_" })).toBe("wiki_")
    expect(getTablePrefix({ TABLE_PREFIX: "app_v2" })).toBe("app_v2_")
  })

  it("显式置空 → 完全不带头前缀", () => {
    expect(getTablePrefix({ TABLE_PREFIX: "" })).toBe("")
    expect(ensureTrailingUnderscore("")).toBe("")
  })

  it("保留字 none 只在 CI 侧翻译，运行时按自定义值处理", () => {
    expect(getTablePrefix({ TABLE_PREFIX: "none" })).toBe("none_")
  })
})

describe("前缀合法性（拼进 SQL 标识符前必须通过）", () => {
  it("空串（无前缀）合法", () => {
    expect(isValidTablePrefix("")).toBe(true)
  })

  it("字母/下划线开头、其后字母数字下划线合法", () => {
    expect(isValidTablePrefix(`${DEFAULT_TABLE_PREFIX}_`)).toBe(true)
    expect(isValidTablePrefix("_shared")).toBe(true)
    expect(isValidTablePrefix("a1_")).toBe(true)
  })

  it("数字开头或含非法字符一律拒绝", () => {
    expect(isValidTablePrefix("2026_")).toBe(false)
    expect(isValidTablePrefix("1abc_")).toBe(false)
    expect(isValidTablePrefix("my-prefix")).toBe(false)
    expect(isValidTablePrefix("my prefix")).toBe(false)
  })
})
