/**
 * waker 回调协议 v2 的验签侧（与平台冻结契约同口径，移植自 eNotify/Ciki）：
 *
 * - 头：`X-Waker-Timestamp`（epoch 秒）、`X-Waker-Execution-Id`、`X-Waker-Job-Id`、
 *   `X-Waker-Signature`（`v2=<小写 hex>`）；
 * - 签名材料：`<timestamp>\n<executionId>\n<jobId>\n<rawBody>`（body 必须是**未解析**
 *   的原始字符串，重新序列化会改键序）；
 * - 时间窗 300 秒；
 * - HMAC-SHA256 用 `crypto.subtle.verify`（原生常量时间），不手搓比较。
 */

export const CALLBACK_PROTOCOL_VERSION = 2
export const CALLBACK_PATH = "/_waker/execute"
export const CALLBACK_TIMESTAMP_TOLERANCE_SECONDS = 300
export const CALLBACK_SIGNATURE_PREFIX = `v${CALLBACK_PROTOCOL_VERSION}=`

export const CALLBACK_HEADERS = {
  timestamp: "X-Waker-Timestamp",
  executionId: "X-Waker-Execution-Id",
  jobId: "X-Waker-Job-Id",
  signature: "X-Waker-Signature"
} as const

const encoder = new TextEncoder()

export type SignatureFailureReason =
  | "missing_signature"
  | "malformed_signature"
  | "missing_signed_field"
  | "stale_timestamp"
  | "bad_signature"

export type SignatureVerification =
  | { ok: true }
  | { ok: false; reason: SignatureFailureReason }

export interface VerifySignatureInput {
  secret: string
  signature: string
  timestamp: string
  executionId: string
  jobId: string
  /** 未解析的原始请求体。 */
  body: string
  now?: number
  toleranceSeconds?: number
}

export function buildSignaturePayload(input: {
  timestamp: string
  executionId: string
  jobId: string
  body: string
}): string {
  return `${input.timestamp}\n${input.executionId}\n${input.jobId}\n${input.body}`
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    if (Number.isNaN(byte)) return null
    bytes[index] = byte
  }
  return bytes
}

export async function verifyWakerSignature(
  input: VerifySignatureInput
): Promise<SignatureVerification> {
  if (input.signature.length === 0) {
    return { ok: false, reason: "missing_signature" }
  }
  if (
    input.executionId.length === 0 ||
    input.jobId.length === 0 ||
    input.timestamp.length === 0
  ) {
    return { ok: false, reason: "missing_signed_field" }
  }
  if (!input.signature.startsWith(CALLBACK_SIGNATURE_PREFIX)) {
    return { ok: false, reason: "malformed_signature" }
  }
  const provided = hexToBytes(
    input.signature.slice(CALLBACK_SIGNATURE_PREFIX.length)
  )
  if (provided === null || provided.length !== 32) {
    return { ok: false, reason: "malformed_signature" }
  }

  const timestampSeconds = Number(input.timestamp)
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "malformed_signature" }
  }
  const now = input.now ?? Date.now()
  const tolerance =
    input.toleranceSeconds ?? CALLBACK_TIMESTAMP_TOLERANCE_SECONDS
  if (Math.abs(now / 1000 - timestampSeconds) > tolerance) {
    return { ok: false, reason: "stale_timestamp" }
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    provided as unknown as BufferSource,
    encoder.encode(buildSignaturePayload(input))
  )
  return valid ? { ok: true } : { ok: false, reason: "bad_signature" }
}
