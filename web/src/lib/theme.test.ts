import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeFromAccount,
  themeToAccount
} from "@/lib/theme"

describe("三档主题解析", () => {
  it("auto 跟随系统，其余原样", () => {
    expect(resolveTheme("auto", true)).toBe("dark")
    expect(resolveTheme("auto", false)).toBe("light")
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("dark", false)).toBe("dark")
  })

  it("账号侧 system/light/dark 与界面三档互转", () => {
    expect(themeFromAccount("system")).toBe("auto")
    expect(themeFromAccount("dark")).toBe("dark")
    expect(themeFromAccount("light")).toBe("light")
    expect(themeFromAccount("nonsense")).toBeNull()
    expect(themeToAccount("auto")).toBe("system")
    expect(themeToAccount("dark")).toBe("dark")
  })
})

describe("主题落 DOM", () => {
  it("applyTheme 切 .dark 与 color-scheme", () => {
    applyTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe("dark")

    applyTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe("light")
  })
})

describe("主题持久化", () => {
  it("读 zustand persist 的 JSON 形态，也兼容裸字符串", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ state: { theme: "dark" }, version: 0 })
    )
    expect(readStoredTheme()).toBe("dark")

    localStorage.setItem(THEME_STORAGE_KEY, "light")
    expect(readStoredTheme()).toBe("light")

    localStorage.setItem(THEME_STORAGE_KEY, "purple")
    expect(readStoredTheme()).toBeNull()
  })

  it("首屏内联脚本与 store 用同一个存储键，且在包体之前执行", () => {
    const html = readFileSync(path.resolve(process.cwd(), "index.html"), "utf8")
    expect(html).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`)
    const scriptAt = html.indexOf("localStorage.getItem")
    const moduleAt = html.indexOf("/src/main.tsx")
    expect(scriptAt).toBeGreaterThan(0)
    expect(moduleAt).toBeGreaterThan(scriptAt)
  })
})
