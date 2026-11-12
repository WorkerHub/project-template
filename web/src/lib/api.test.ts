import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, authApi, meApi } from "@/lib/api"
import { useAuthStore } from "@/stores/auth"
import { me } from "@/test/fixtures"

/**
 * 会话失效的兜底（规格 §6.1「私有接口未登录 401」）：私有接口 401 必须
 * 清掉本地用户态，让 RequireAuth 把人送回登录页；登录等公开鉴权端点
 * 自己的 401 是业务结果，不能顺手把已有会话清掉。
 */

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => respond(status, body))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ user: null, status: "loading" })
})

describe("401 处理", () => {
  it("私有接口 401 时清掉本地会话", async () => {
    useAuthStore.setState({ user: me(), status: "ready" })
    stubFetch(401, { error: "Unauthorized" })

    await expect(meApi.get()).rejects.toBeInstanceOf(ApiError)
    await vi.waitFor(() => {
      expect(useAuthStore.getState().user).toBeNull()
    })
  })

  it("登录失败的 401 不动已有用户态", async () => {
    useAuthStore.setState({ user: me(), status: "ready" })
    stubFetch(401, {
      error: "Invalid credentials",
      code: "INVALID_CREDENTIALS"
    })

    await expect(
      authApi.login({ email: "owner@example.com", password: "wrong" })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" })
    await Promise.resolve()
    expect(useAuthStore.getState().user).not.toBeNull()
  })
})
