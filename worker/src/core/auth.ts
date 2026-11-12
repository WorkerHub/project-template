/**
 * 鉴权底层原语：哈希、常数时间比较、随机令牌、密码哈希。
 *
 * 密码哈希照 eNotify 现行实现（PBKDF2-SHA256、100_000 次迭代、32 字节随机盐、
 * `salt:hash` 十六进制），不新发明算法也不换参数——存量项目的哈希要能对得上。
 */

const encoder = new TextEncoder()

const PBKDF2_ITERATIONS = 100_000
const PASSWORD_KEY_BITS = 256
const PASSWORD_SALT_BYTES = 32

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
 * HMAC-SHA256（十六进制输出）：验证码哈希的唯一实现。用签名钥做密钥，库里只存
 * 结果——6 位数字码本身熵低，裸哈希在库被读时容易被枚举。
 */
export async function hmacSignatureHex(
  key: string,
  message: string
): Promise<string> {
  const cryptoKey = await importHmacKey(key, ["sign"])
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message)
  )
  return bufToHex(signature)
}

async function importHmacKey(
  key: string,
  usages: string[]
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  )
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

/**
 * 密钥是否已配置：缺失、空白、或仍是部署模板里的 `*_PLACEHOLDER` 一律算未配置。
 * setup 密钥与签名钥共用这一条判定（口径一致，不各写一套）。
 */
export function isConfiguredSecret(secret?: string | null): boolean {
  if (typeof secret !== "string") return false
  const trimmed = secret.trim()
  if (!trimmed) return false
  return !trimmed.endsWith("_PLACEHOLDER")
}

/** SIGNING_SECRET 是否可用；未配置时需签名的端点一律失败关闭。 */
export function isSigningSecretConfigured(secret?: string | null): boolean {
  return isConfiguredSecret(secret)
}

async function derivePassword(
  password: string,
  salt: Uint8Array
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  )
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    PASSWORD_KEY_BITS
  )
}

/** 生成 `salt:hash`（均为十六进制），逐字沿用 eNotify 的存储格式。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES))
  const hash = await derivePassword(password, salt)
  return `${bufToHex(salt.buffer as ArrayBuffer)}:${bufToHex(hash)}`
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const colon = stored.indexOf(":")
  if (colon === -1) return false
  const saltHex = stored.slice(0, colon)
  const storedHash = stored.slice(colon + 1)
  if (!saltHex || !storedHash) return false

  const salt = new Uint8Array(saltHex.length / 2)
  for (let i = 0; i < salt.length; i += 1) {
    salt[i] = Number.parseInt(saltHex.slice(i * 2, i * 2 + 2), 16)
  }
  const hashHex = bufToHex(await derivePassword(password, salt))
  return safeEqual(hashHex, storedHash)
}
