import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi, ApiError, authApi, meApi } from "@/lib/api"
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

  it("Passkey 直接登录失败的 401 不动已有用户态", async () => {
    useAuthStore.setState({ user: me(), status: "ready" })
    stubFetch(401, {
      error: "Passkey verification failed",
      code: "PASSKEY_FAILED"
    })

    await expect(
      authApi.passkeyDirectLoginVerify({ id: "invalid-credential" })
    ).rejects.toMatchObject({ code: "PASSKEY_FAILED" })
    await Promise.resolve()
    expect(useAuthStore.getState().user).not.toBeNull()
  })
})

describe("用户管理操作列端点", () => {
  /** 五个端点已在后端冻结：路径、方法与 role 请求体由这里锁住，防止前端漂移。 */
  function recordFetch() {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body
        })
        return respond(200, { success: true })
      })
    )
    return calls
  }

  it("重置密码 / 停用 / 启用 / 删除走 POST 且无请求体", async () => {
    const calls = recordFetch()

    await adminApi.resetUserPassword(7)
    await adminApi.disableUser(7)
    await adminApi.enableUser(7)
    await adminApi.deleteUser(7)

    expect(calls).toEqual([
      {
        url: "/api/admin/users/7/reset-password",
        method: "POST",
        body: undefined
      },
      { url: "/api/admin/users/7/disable", method: "POST", body: undefined },
      { url: "/api/admin/users/7/enable", method: "POST", body: undefined },
      { url: "/api/admin/users/7/delete", method: "POST", body: undefined }
    ])
  })

  it("变更角色把目标角色放进请求体", async () => {
    const calls = recordFetch()

    await adminApi.changeUserRole(7, { role: "admin" })

    expect(calls).toEqual([
      {
        url: "/api/admin/users/7/role",
        method: "POST",
        body: JSON.stringify({ role: "admin" })
      }
    ])
  })
})

describe("Passkey 直接登录端点", () => {
  function recordFetch() {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body
        })
        return respond(200, { success: true })
      })
    )
    return calls
  }

  it("options 端点走 POST 且无请求体，verify 端点走 POST 并携带 credential", async () => {
    const calls = recordFetch()
    const mockCredential = { id: "cred-123", rawId: "cred-123" }

    await authApi.passkeyDirectLoginOptions()
    await authApi.passkeyDirectLoginVerify(mockCredential)

    expect(calls).toEqual([
      {
        url: "/api/auth/passkey/login/options",
        method: "POST",
        body: undefined
      },
      {
        url: "/api/auth/passkey/login/verify",
        method: "POST",
        body: JSON.stringify({ credential: mockCredential })
      }
    ])
  })
})
