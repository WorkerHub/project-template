/**
 * 鉴权底层小工具：哈希、常数时间比较、随机令牌。
 *
 * 密码哈希与凭据细节在后续的鉴权单里实现（对齐 eNotify 现行实现）；这里只提供
 * 会话令牌哈希与 setup 密钥比较这两个本单就要用的原语。
 */

const encoder = new TextEncoder()

export function bufToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input))
  return bufToHex(digest)
}

/**
 * 常量时间字符串比较：两边先各自 SHA-256，再逐字节异或——长度差异不会通过
 * 提前返回泄漏，比较耗时与内容无关。setup 密钥比较的唯一实现。
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b))
  ])
  const va = new Uint8Array(ha)
  const vb = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}

/** 32 字节随机令牌，URL 安全 base64 编码（只回给 Cookie，永不落库）。 */
export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  const binary = String.fromCharCode(...buffer)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
