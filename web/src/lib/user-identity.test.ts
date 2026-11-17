import { describe, expect, it } from "vitest"
import { accountInitial, accountPrimaryLabel } from "@/lib/user-identity"

const base = { email: "owner@example.com", displayName: "Owner" }

describe("账号身份", () => {
  it("显示名称优先于邮箱", () => {
    expect(accountPrimaryLabel(base)).toBe("Owner")
    expect(accountInitial(base)).toBe("O")
  })

  it("显示名称为空时回落到邮箱", () => {
    const user = { ...base, displayName: "" }
    expect(accountPrimaryLabel(user)).toBe("owner@example.com")
    expect(accountInitial(user)).toBe("O")
  })

  it("全空与空用户返回空串", () => {
    expect(accountPrimaryLabel(null)).toBe("")
    expect(accountInitial({ ...base, displayName: "", email: "" })).toBe("")
  })

  it("按码点取首字，代理对不被截断", () => {
    expect(accountInitial({ ...base, displayName: "🙂船" })).toBe("🙂")
  })

  it("首字母转大写", () => {
    expect(accountInitial({ ...base, displayName: "sailor" })).toBe("S")
  })
})
