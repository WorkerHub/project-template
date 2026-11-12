import { render, screen } from "@testing-library/react"
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject
} from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { ApiError } from "@/lib/api"
import { me, publicInfo, setupState } from "@/test/fixtures"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    publicApi: { get: vi.fn() },
    setupApi: { ...actual.setupApi, state: vi.fn() },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() },
    authApi: { ...actual.authApi, logout: vi.fn() },
    adminApi: {
      ...actual.adminApi,
      settings: vi.fn(),
      pendingUsers: vi.fn()
    }
  }
})

const { publicApi, setupApi, meApi } = await import("@/lib/api")

function renderAt(entries: RouteObject[] = routes, path = "/") {
  const router = createMemoryRouter(entries, { initialEntries: [path] })
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}

beforeEach(() => {
  vi.mocked(publicApi.get).mockResolvedValue(publicInfo())
  vi.mocked(meApi.get).mockRejectedValue(
    new ApiError({ status: 401, message: "Unauthorized" })
  )
})

describe("路由与根门", () => {
  it("未初始化时打开任意页面都被引导到 setup", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(setupState())
    renderAt(routes, "/")

    expect(await screen.findByLabelText("部署密钥")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "初始化" })).toBeInTheDocument()
  })

  it("已初始化时访客进入公开首页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    renderAt(routes, "/")

    expect(
      await screen.findByRole("link", { name: "登录" })
    ).toBeInTheDocument()
  })

  it("迁移完成但尚无所有者时不再弹回 setup，注册页可达", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: false, enabled: false })
    )
    renderAt(routes, "/register")

    expect(await screen.findByLabelText("邮箱")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "注册" })).toBeInTheDocument()
  })

  it("会话失效时不留在空白工作台，回到登录页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    renderAt(routes, "/workbench")

    expect(
      await screen.findByRole("heading", { name: "登录" })
    ).toBeInTheDocument()
  })

  it("管理员能看到「系统管理」入口，普通成员看不到", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    const view = renderAt(routes, "/workbench")
    expect(
      await screen.findByRole("link", { name: "系统管理" })
    ).toBeInTheDocument()
    view.unmount()

    vi.mocked(meApi.get).mockResolvedValue(me({ role: "user" }))
    renderAt(routes, "/workbench")
    expect(
      await screen.findByRole("link", { name: "工作台" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "系统管理" })
    ).not.toBeInTheDocument()
  })
})
