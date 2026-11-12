/**
 * 邮件模板（规格 §5.6、§6.5）：中文 + 英文各一份，键一一对应。
 *
 * 只覆盖模板里会发的三类邮件：注册邮箱验证码、找回密码验证码、测试邮件。
 * 项目名取 `config/project.ts` 的 PROJECT_NAME（不写字面量，生成新项目后自动跟着变）。
 * 新增邮件类型必须同时补两种语言——`worker/test/email-locales.test.ts` 会核对语言集合。
 */
import { PROJECT_NAME } from "../config/project"

export type EmailLanguage = "zh" | "en"

export const SUPPORTED_LANGUAGES: EmailLanguage[] = ["zh", "en"]

/** 语言代码归一化：只接受支持集，其它一律 null（由调用方决定兜底）。 */
export function normalizeLanguage(value: unknown): EmailLanguage | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  return SUPPORTED_LANGUAGES.includes(normalized as EmailLanguage)
    ? (normalized as EmailLanguage)
    : null
}

export interface EmailContent {
  subject: string
  html: string
  text: string
}

export type CodeEmailPurpose = "register_verify" | "password_reset"

const CODE_TTL_MINUTES = 10

/** 6 位数字码的三种语言文案；`code` 只含数字，无需转义。 */
export function renderCodeEmail(
  language: EmailLanguage,
  purpose: CodeEmailPurpose,
  code: string
): EmailContent {
  const templates: Record<
    EmailLanguage,
    Record<CodeEmailPurpose, EmailContent>
  > = {
    zh: {
      register_verify: {
        subject: `${PROJECT_NAME} 邮箱验证码`,
        html: `<p>您的邮箱验证码是：<strong>${code}</strong></p><p>有效期 ${CODE_TTL_MINUTES} 分钟。</p>`,
        text: `您的邮箱验证码是：${code}\n有效期 ${CODE_TTL_MINUTES} 分钟。`
      },
      password_reset: {
        subject: `${PROJECT_NAME} 密码重置验证码`,
        html: `<p>您的密码重置验证码是：<strong>${code}</strong></p><p>有效期 ${CODE_TTL_MINUTES} 分钟。如果不是您本人操作，请忽略本邮件。</p>`,
        text: `您的密码重置验证码是：${code}\n有效期 ${CODE_TTL_MINUTES} 分钟。如果不是您本人操作，请忽略本邮件。`
      }
    },
    en: {
      register_verify: {
        subject: `${PROJECT_NAME} email verification code`,
        html: `<p>Your email verification code is: <strong>${code}</strong></p><p>It expires in ${CODE_TTL_MINUTES} minutes.</p>`,
        text: `Your email verification code is: ${code}\nIt expires in ${CODE_TTL_MINUTES} minutes.`
      },
      password_reset: {
        subject: `${PROJECT_NAME} password reset code`,
        html: `<p>Your password reset code is: <strong>${code}</strong></p><p>It expires in ${CODE_TTL_MINUTES} minutes. If you did not request this, ignore this email.</p>`,
        text: `Your password reset code is: ${code}\nIt expires in ${CODE_TTL_MINUTES} minutes. If you did not request this, ignore this email.`
      }
    }
  }
  return templates[language][purpose]
}

/** 系统管理「发送测试邮件」用的模板。 */
export function renderTestEmail(language: EmailLanguage): EmailContent {
  const templates: Record<EmailLanguage, EmailContent> = {
    zh: {
      subject: `${PROJECT_NAME} 测试邮件`,
      html: `<p>这是一封测试邮件。收到它说明邮件配置可用。</p><p>发送时间：${new Date().toISOString()}</p>`,
      text: `这是一封测试邮件。收到它说明邮件配置可用。发送时间：${new Date().toISOString()}`
    },
    en: {
      subject: `${PROJECT_NAME} test email`,
      html: `<p>This is a test email. Receiving it means the mail configuration works.</p><p>Sent at: ${new Date().toISOString()}</p>`,
      text: `This is a test email. Receiving it means the mail configuration works. Sent at: ${new Date().toISOString()}`
    }
  }
  return templates[language]
}
