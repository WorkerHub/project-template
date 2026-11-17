/**
 * SMTP 传输层 DATA 载荷拼装测试：验证顶层 Content-Type 位于空行之前的信头区。
 * 通过注入假 `cloudflare:sockets.connect` 捕获写入字节，不依赖真实网络。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }))

vi.mock("cloudflare:sockets", () => ({ connect: connectMock }))

import {
  encodeUtf8Base64,
  sendSmtpMessage,
  wrapBase64
} from "../src/services/smtp-transport"

interface CapturedSocket {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  close(): Promise<void>
}

function makeSocket(responses: string[]): {
  socket: CapturedSocket
  writes: string[]
} {
  const writes: string[] = []
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(responses.join("")))
      controller.close()
    }
  })
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writes.push(dec.decode(chunk))
    }
  })
  return { socket: { readable, writable, close: async () => {} }, writes }
}

/** 465 隐式 TLS、无账号：220 → EHLO 250 → MAIL 250 → RCPT 250 → DATA 354 → 250。 */
const SMTP_RESPONSES = [
  "220 smtp.example.com ESMTP\r\n",
  "250 ok\r\n",
  "250 ok\r\n",
  "250 ok\r\n",
  "354 go ahead\r\n",
  "250 queued\r\n"
]

function dataPayload(writes: string[]): string {
  const payload = writes.find((w) => w.includes("Content-Type"))
  if (!payload) throw new Error("未捕获到 DATA 载荷")
  return payload
}

/** 拆出信头区与正文区（首个 \r\n\r\n 之前为信头）。 */
function splitHeaderBody(payload: string): { header: string; body: string } {
  const idx = payload.indexOf("\r\n\r\n")
  if (idx < 0) throw new Error("DATA 载荷没有空行分隔")
  return { header: payload.slice(0, idx), body: payload.slice(idx + 4) }
}

beforeEach(() => {
  connectMock.mockReset()
})

describe("sendSmtpMessage DATA 载荷", () => {
  it("multipart（带 text）：顶层 Content-Type 在信头区，正文从 boundary 开始", async () => {
    const { socket, writes } = makeSocket(SMTP_RESPONSES)
    connectMock.mockReturnValue(socket)

    const html = "<p>你好，世界！</p>"
    const text = "你好，世界！"
    const result = await sendSmtpMessage(
      { host: "smtp.example.com", port: 465 },
      {
        to: "to@example.com",
        subject: "你好",
        html,
        text,
        from: "from@example.com"
      }
    )

    expect(result).toEqual({ success: true })
    const payload = dataPayload(writes)
    const { header, body } = splitHeaderBody(payload)

    const m = header.match(/boundary="([^"]+)"/)
    expect(m).not.toBeNull()
    const boundary = m![1]

    expect(header).toContain(
      `Content-Type: multipart/alternative; boundary="${boundary}"`
    )
    expect(header).not.toContain("Content-Transfer-Encoding")
    expect(header).toContain("MIME-Version: 1.0")
    expect(header).toContain("=?UTF-8?B?")

    const expectedBody =
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
      `--${boundary}--\r\n.\r\n`
    expect(body).toBe(expectedBody)
  })

  it("纯 html：Content-Type 与 CTE 在信头区，正文只有 base64 载荷", async () => {
    const { socket, writes } = makeSocket(SMTP_RESPONSES)
    connectMock.mockReturnValue(socket)

    const html = "<p>hello</p>"
    const result = await sendSmtpMessage(
      { host: "smtp.example.com", port: 465 },
      {
        to: "to@example.com",
        subject: "hello",
        html,
        from: "from@example.com"
      }
    )

    expect(result).toEqual({ success: true })
    const payload = dataPayload(writes)
    const { header, body } = splitHeaderBody(payload)

    expect(header).toContain("Content-Type: text/html; charset=UTF-8")
    expect(header).toContain("Content-Transfer-Encoding: base64")

    expect(body).toBe(`${wrapBase64(encodeUtf8Base64(html))}\r\n.\r\n`)
    expect(body.startsWith("Content-Type")).toBe(false)
  })
})
