/**
 * 规格 §7-10（邮件部分）：zh/en 两份模板同时存在，新增邮件类型必须补两种语言；
 * 语言代码只接受支持集。
 */
import { describe, expect, it } from "vitest"
import {
  normalizeLanguage,
  renderCodeEmail,
  renderTestEmail,
  SUPPORTED_LANGUAGES,
  type CodeEmailPurpose
} from "../src/locales/email"

const PURPOSES: CodeEmailPurpose[] = ["register_verify", "password_reset"]

describe("邮件模板双语", () => {
  it("两种语言 × 两种用途都有完整 subject/html/text，且不互相等同", () => {
    for (const purpose of PURPOSES) {
      const zh = renderCodeEmail("zh", purpose, "123456")
      const en = renderCodeEmail("en", purpose, "123456")
      for (const content of [zh, en]) {
        expect(content.subject.length).toBeGreaterThan(0)
        expect(content.html).toContain("123456")
        expect(content.text).toContain("123456")
      }
      expect(zh.subject).not.toBe(en.subject)
      expect(zh.html).not.toBe(en.html)
      expect(zh.text).not.toBe(en.text)
    }
  })

  it("测试邮件同样双语", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const content = renderTestEmail(language)
      expect(content.subject.length).toBeGreaterThan(0)
      expect(content.html.length).toBeGreaterThan(0)
      expect(content.text.length).toBeGreaterThan(0)
    }
    expect(renderTestEmail("zh").subject).not.toBe(
      renderTestEmail("en").subject
    )
  })

  it("语言代码归一化只接受 zh/en", () => {
    expect(normalizeLanguage("zh")).toBe("zh")
    expect(normalizeLanguage("EN")).toBe("en")
    expect(normalizeLanguage(" en ")).toBe("en")
    expect(normalizeLanguage("ja")).toBeNull()
    expect(normalizeLanguage(undefined)).toBeNull()
    expect(normalizeLanguage(42)).toBeNull()
  })
})
