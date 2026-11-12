/**
 * SMTP 传输层（移植 eNotify 现行实现）：只负责说 SMTP，不关心配置从哪来。
 * 用 Workers 原生 `cloudflare:sockets`，不引第三方邮件库。
 *
 * - 465 端口走隐式 TLS，其余走 STARTTLS；
 * - 服务器不支持 STARTTLS 却配了账号密码 → 拒绝发送（绝不把凭证明文发出去）；
 * - AUTH LOGIN；正文 base64，HTML + 可选纯文本用 multipart/alternative。
 */
import { connect } from "cloudflare:sockets"

export interface SmtpTransportConfig {
  host: string
  port: number
  username?: string
  password?: string
}

export interface SmtpMessage {
  to: string
  subject: string
  html: string
  text?: string
  /** Envelope/header sender address. */
  from: string
  /** Display name for the From header (optional). */
  fromName?: string
}

interface SocketLike {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  close(): Promise<void>
  startTls(): SocketLike
}

export async function sendSmtpMessage(
  config: SmtpTransportConfig,
  message: SmtpMessage
): Promise<{ success: boolean; error?: string }> {
  const from = message.from || "noreply@example.com"
  const fromName = (message.fromName || "").replace(/[\r\n]/g, "")
  const isImplicitTls = config.port === 465

  const socket = connect(
    { hostname: config.host, port: config.port },
    {
      secureTransport: isImplicitTls ? "on" : "starttls",
      allowHalfOpen: false
    }
  ) as unknown as SocketLike

  try {
    const session = new SmtpSession(socket)

    await session.expect(220)
    await session.cmd("EHLO worker")
    await session.expect(250)

    if (!isImplicitTls) {
      const upgraded = await session.tryStartTls()
      if (!upgraded && config.username && config.password) {
        throw new Error(
          "Server does not support STARTTLS; refusing to send credentials in plaintext"
        )
      }
    }

    if (config.username && config.password) {
      await session.authLogin(config.username, config.password)
    }

    await session.sendMessage(
      from,
      fromName,
      message.to,
      message.subject,
      message.html,
      message.text
    )
    await session.quit()
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: `SMTP error: ${err instanceof Error ? err.message : String(err)}`
    }
  } finally {
    await socket.close().catch(() => {})
  }
}

class SmtpSession {
  private buf = ""
  private readonly dec = new TextDecoder()
  private socket: SocketLike
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>

  constructor(socket: SocketLike) {
    this.socket = socket
    this.reader = socket.readable.getReader()
    this.writer = socket.writable.getWriter()
  }

  async tryStartTls(): Promise<boolean> {
    await this.cmd("STARTTLS")
    const resp = await this.readResponse()
    if (resp.code !== 220) return false

    this.reader.releaseLock()
    this.writer.releaseLock()

    const tls = this.socket.startTls()
    this.socket = tls
    this.reader = tls.readable.getReader()
    this.writer = tls.writable.getWriter()
    this.buf = ""

    await this.cmd("EHLO worker")
    await this.expect(250)
    return true
  }

  async authLogin(user: string, pass: string): Promise<void> {
    await this.cmd("AUTH LOGIN")
    await this.expect(334)
    await this.cmd(btoa(user))
    await this.expect(334)
    await this.cmd(btoa(pass))
    await this.expect(235)
  }

  async sendMessage(
    from: string,
    fromName: string,
    to: string,
    subject: string,
    html: string,
    text?: string
  ): Promise<void> {
    await this.cmd(`MAIL FROM:<${from}>`)
    await this.expect(250)
    await this.cmd(`RCPT TO:<${to}>`)
    await this.expect(250)
    await this.cmd("DATA")
    await this.expect(354)

    const date = new Date().toUTCString()
    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@worker>`
    const encodedSubject = `=?UTF-8?B?${encodeUtf8Base64(subject)}?=`
    const headers =
      `From: ${fromName} <${from}>\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${encodedSubject}\r\n` +
      `Date: ${date}\r\n` +
      `Message-ID: ${msgId}\r\n` +
      `MIME-Version: 1.0\r\n`

    let body: string
    if (text) {
      const boundary = `==worker_${Date.now()}_${Math.random().toString(36).slice(2)}`
      body =
        `Content-Type: multipart/alternative; boundary="${boundary}"\r\n` +
        `\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain; charset=UTF-8\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `\r\n` +
        `${wrapBase64(encodeUtf8Base64(text))}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/html; charset=UTF-8\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `\r\n` +
        `${wrapBase64(encodeUtf8Base64(html))}\r\n` +
        `--${boundary}--\r\n`
    } else {
      body =
        `Content-Type: text/html; charset=UTF-8\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `\r\n` +
        `${wrapBase64(encodeUtf8Base64(html))}\r\n`
    }

    await this.writer.write(
      new TextEncoder().encode(`${headers}\r\n${body}.\r\n`)
    )
    await this.expect(250)
  }

  async quit(): Promise<void> {
    await this.cmd("QUIT").catch(() => {})
  }

  async cmd(line: string): Promise<void> {
    await this.writer.write(new TextEncoder().encode(`${line}\r\n`))
  }

  async expect(code: number): Promise<void> {
    const resp = await this.readResponse()
    if (resp.code !== code) {
      throw new Error(
        `SMTP: expected ${code}, got ${resp.code} — ${resp.message}`
      )
    }
  }

  async readResponse(): Promise<{ code: number; message: string }> {
    const lines: string[] = []
    for (;;) {
      while (!this.buf.includes("\r\n")) {
        const { value, done } = await this.reader.read()
        if (done) throw new Error("SMTP: connection closed unexpectedly")
        if (value) this.buf += this.dec.decode(value, { stream: true })
      }

      const eol = this.buf.indexOf("\r\n")
      const line = this.buf.slice(0, eol)
      this.buf = this.buf.slice(eol + 2)
      lines.push(line)

      // RFC 5321：末行第 4 个字符是空格，续行是 `-`。
      if (line.length <= 3 || line[3] === " ") {
        const code = Number.parseInt(line.slice(0, 3), 10)
        if (Number.isNaN(code)) {
          throw new Error(`SMTP: invalid response line: ${line}`)
        }
        return { code, message: lines.map((l) => l.slice(4)).join("\n") }
      }
    }
  }
}

export function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function wrapBase64(b64: string): string {
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? b64
}
