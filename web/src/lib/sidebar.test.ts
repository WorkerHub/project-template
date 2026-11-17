import { describe, expect, it } from "vitest"
import {
  clampSidebarWidth,
  readSidebarOpen,
  readSidebarWidth,
  SIDEBAR_OPEN_STORAGE_KEY,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STORAGE_KEY,
  writeSidebarOpen,
  writeSidebarWidth
} from "@/lib/sidebar"

describe("侧栏宽度", () => {
  it("没存过时用默认宽度 240", () => {
    expect(readSidebarWidth()).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it("越界各自夹到最小 200 / 最大 360", () => {
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(999)).toBe(SIDEBAR_WIDTH_MAX)

    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "120")
    expect(readSidebarWidth()).toBe(SIDEBAR_WIDTH_MIN)
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "999")
    expect(readSidebarWidth()).toBe(SIDEBAR_WIDTH_MAX)
  })

  it("非法值回落默认，小数取整，范围取原值", () => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "wide")
    expect(readSidebarWidth()).toBe(SIDEBAR_WIDTH_DEFAULT)

    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "245.6")
    expect(readSidebarWidth()).toBe(246)

    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "320")
    expect(readSidebarWidth()).toBe(320)
  })

  it("写入的是整数 px 字符串，且同样夹取", () => {
    writeSidebarWidth(320)
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("320")

    writeSidebarWidth(999)
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("360")
  })
})

describe("侧栏开合状态", () => {
  it("没存过时按展开", () => {
    expect(readSidebarOpen()).toBe(true)
  })

  it("只有明确的 false 才算收起", () => {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")
    expect(readSidebarOpen()).toBe(false)

    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "true")
    expect(readSidebarOpen()).toBe(true)

    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "")
    expect(readSidebarOpen()).toBe(true)
  })

  it("写回的字符串能原样读回", () => {
    writeSidebarOpen(false)
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("false")
    expect(readSidebarOpen()).toBe(false)

    writeSidebarOpen(true)
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true")
    expect(readSidebarOpen()).toBe(true)
  })
})
