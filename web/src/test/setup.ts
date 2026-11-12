import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, beforeEach, vi } from "vitest"
import { i18n } from "@/i18n"

/**
 * 测试环境的公共卫生：jsdom 的 matchMedia、语言与 localStorage。
 *
 * 注意：这里不在模块顶层 import 任何 store —— store 会在 import 时抓住当时的
 * api 模块，早于测试文件的 vi.mock 就会拿到真实客户端。改为每个用例动态 import，
 * 保证页面测试注入的 mock 生效。
 */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

async function resetStores() {
  const [
    { useAuthStore },
    { useSetupStore },
    { useSiteStore },
    { useThemeStore }
  ] = await Promise.all([
    import("@/stores/auth"),
    import("@/stores/setup"),
    import("@/stores/site"),
    import("@/stores/theme")
  ])
  useAuthStore.setState({ user: null, status: "ready" })
  useSetupStore.setState({ state: null, loaded: false })
  useSiteStore.setState({ info: null, loaded: false })
  useThemeStore.setState({ theme: "auto" })
}

beforeEach(async () => {
  localStorage.clear()
  document.documentElement.className = ""
  document.documentElement.removeAttribute("style")
  document.documentElement.lang = "zh"
  await i18n.changeLanguage("zh")
  await resetStores()
})

afterEach(async () => {
  cleanup()
  await resetStores()
  localStorage.clear()
})
