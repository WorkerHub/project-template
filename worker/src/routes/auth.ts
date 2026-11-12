/**
 * 鉴权路由（规格 §5.4、§5.6）：注册与审核、两步登录、通行密钥第二因子、
 * 注册邮箱验证码、找回密码。
 *
 * 所有端点要么在 `index.ts` 的公开表里（未登录可达），要么被会话中间件拦住；
 * 这里不另写鉴权层。错误统一 `{error, code}`，`code` 是前端翻译用的稳定契约。
 */
import { Hono } from "hono"
import type { Context } from "hono"
import { APP_MODE } from "../config/project"
import {
  hashPassword,
  isSigningSecretConfigured,
  verifyPassword
} from "../core/auth"
import {
  clearCounter,
  consumeCounter,
  lockCounter,
  readCounter
} from "../core/counters"
import { enforceRateLimit } from "../core/rate-limit"
import {
  clearSessionCookie,
  createSession,
  findSession,
  readSessionToken,
  revokeAllSessions,
  revokeSession,
  setSessionCookie
} from "../core/session"
import { signTempToken, verifyTempToken } from "../core/tokens"
import { verifyTotpCode } from "../core/totp"
import {
  checkResendCooldown,
  issueVerificationCode,
  verifyVerificationCode
} from "../core/verification-codes"
import {
  clearChallengeCookie,
  createAuthenticationOptions,
  readChallengeCookie,
  relyingParty,
  setChallengeCookie,
  verifyAuthentication
} from "../core/webauthn"
import {
  findPasskeyByCredentialId,
  listPasskeys,
  touchPasskey
} from "../db/queries/passkeys"
import { getTwoFactor } from "../db/queries/twofa"
import {
  findUserByEmail,
  findUserById,
  insertRegisteredUser,
  updateUserFields,
  type UserRow
} from "../db/queries/users"
import {
  apiError,
  clientIp,
  nowSeconds,
  rateLimited,
  readJsonBody
} from "../lib/http"
import {
  emailVerificationEnforced,
  readRegistrationSettings
} from "../lib/settings"
import { isInitialized } from "../lib/setup"
import { getTablePrefix } from "../lib/table-prefix"
import { buildUserView } from "../lib/user-view"
import { normalizeLanguage, renderCodeEmail } from "../locales/email"
import { isEmailConfigured, isValidEmail, sendEmail } from "../services/email"
import type { Env, HonoEnv } from "../types"

export const authRoutes = new Hono<HonoEnv>()

// ─── 限流口径（全部走 auth_counters） ──────────────────────────────────────────

const REGISTER_LIMIT = { action: "register", windowSeconds: 300, max: 5 }
const LOGIN_LIMIT = { action: "login", windowSeconds: 300, max: 10 }
const FORGOT_LIMIT = { action: "password_forgot", windowSeconds: 300, max: 3 }
const RESET_LIMIT = { action: "password_reset", windowSeconds: 300, max: 5 }
const EMAIL_VERIFY_LIMIT = {
  action: "email_verify",
  windowSeconds: 300,
  max: 10
}
const EMAIL_RESEND_LIMIT = {
  action: "email_resend",
  windowSeconds: 300,
  max: 3
}
const TWO_FA_LIMIT = { action: "2fa_verify", windowSeconds: 300, max: 10 }
const TWO_FA_FAIL_LIMIT = { action: "2fa_fail", windowSeconds: 300, max: 5 }
const PASSKEY_LIMIT = {
  action: "passkey_challenge",
  windowSeconds: 300,
  max: 10
}

/** 连续失败锁定：窗口内 8 次失败 → 锁 15 分钟。 */
const LOGIN_FAIL = { action: "login_fail", windowSeconds: 900 }
const LOGIN_LOCK = { action: "login_lock" }
const LOGIN_FAIL_THRESHOLD = 8
const LOGIN_LOCK_SECONDS = 900

const STEP_UP_USED = { action: "stepup_used", windowSeconds: 300 }
const TOTP_USED = { action: "totp_used", windowSeconds: 120 }

/** 用户不存在时也跑一次 PBKDF2，避免通过响应耗时判断账号是否存在。 */
const DUMMY_PASSWORD_HASH = `${"0".repeat(64)}:${"0".repeat(64)}`

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function secretOf(env: Env): string | null {
  if (!isSigningSecretConfigured(env.SIGNING_SECRET)) return null
  return env.SIGNING_SECRET as string
}

type Ctx = Context<HonoEnv>

function authUnavailable(c: Ctx): Response {
  return apiError(
    c,
    500,
    "AUTH_UNAVAILABLE",
    "Signing secret is not configured on this server"
  )
}

/**
 * 数据库还没初始化时，这些端点一律回 409 `SETUP_REQUIRED`：它们都要读写计数表/
 * 用户表，硬跑只会变成 500。前端据此把用户导到 /setup。
 */
async function requireInitialized(
  c: Ctx,
  prefix: string
): Promise<Response | null> {
  if (await isInitialized(c.env.DB, prefix)) return null
  return apiError(
    c,
    409,
    "SETUP_REQUIRED",
    "The database has not been set up yet"
  )
}

/** 发验证码邮件：失败只记日志，不回滚注册、也不向调用方泄露发送结果。 */
async function sendVerificationCode(
  env: Env,
  input: {
    email: string
    purpose: "register_verify" | "password_reset"
    language: "zh" | "en"
  }
): Promise<void> {
  const { code } = await issueVerificationCode(env, {
    email: input.email,
    purpose: input.purpose
  })
  const content = renderCodeEmail(input.language, input.purpose, code)
  const result = await sendEmail(env, {
    to: input.email,
    subject: content.subject,
    html: content.html,
    text: content.text
  })
  if (!result.success) {
    console.error(
      `Verification code email failed (${input.purpose}):`,
      result.error ?? "unknown error"
    )
  }
}

// ─── 注册与审核 ───────────────────────────────────────────────────────────────

authRoutes.post("/register", async (c) => {
  const body = await readJsonBody<{
    email?: string
    password?: string
    language?: string
  }>(c)
  if (!body) return apiError(c, 400, "INVALID_EMAIL", "Invalid request body")

  const email = normalizeEmail(body.email)
  if (!isValidEmail(email)) {
    return apiError(c, 400, "INVALID_EMAIL", "Invalid email address")
  }
  const password = typeof body.password === "string" ? body.password : ""
  if (password.length < 8) {
    return apiError(
      c,
      400,
      "WEAK_PASSWORD",
      "Password must be at least 8 characters"
    )
  }
  const language =
    body.language === undefined ? "zh" : normalizeLanguage(body.language)
  if (!language) {
    return apiError(c, 400, "INVALID_LANGUAGE", "Unsupported language")
  }

  // 单人档：注册接口关闭（规格 §6.4）。
  if (APP_MODE !== "multi") {
    return apiError(
      c,
      403,
      "REGISTRATION_DISABLED",
      "Registration is disabled in single-user mode"
    )
  }

  const prefix = getTablePrefix(c.env)
  const notReady = await requireInitialized(c, prefix)
  if (notReady) return notReady
  const limit = await enforceRateLimit(c.env.DB, prefix, {
    ...REGISTER_LIMIT,
    ip: clientIp(c)
  })
  if (!limit.allowed) return rateLimited(c, limit.retryAfter)

  const registration = await readRegistrationSettings(c.env)
  if (!registration.enabled) {
    return apiError(c, 403, "REGISTRATION_DISABLED", "Registration is disabled")
  }

  if (await findUserByEmail(c.env.DB, prefix, email)) {
    return apiError(c, 409, "EMAIL_TAKEN", "Email is already registered")
  }

  const requiresVerification = await emailVerificationEnforced(c.env)
  let user: UserRow
  try {
    user = await insertRegisteredUser(c.env.DB, prefix, {
      email,
      passwordHash: await hashPassword(password),
      language,
      approvalRequired: registration.approvalRequired,
      emailVerificationRequired: requiresVerification
    })
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      return apiError(c, 409, "EMAIL_TAKEN", "Email is already registered")
    }
    throw err
  }

  const needsVerification = requiresVerification && user.email_verified === 0
  if (needsVerification) {
    await sendVerificationCode(c.env, {
      email,
      purpose: "register_verify",
      language
    }).catch((err: unknown) => {
      console.error(
        "register verification email failed:",
        err instanceof Error ? err.message : err
      )
    })
  }

  return c.json(
    {
      requiresApproval: user.status === "pending",
      requiresEmailVerification: needsVerification
    },
    201
  )
})

// ─── 登录（密码步 → 第二因子） ─────────────────────────────────────────────────

function lockKey(email: string) {
  return { action: LOGIN_LOCK.action, account: email }
}

async function registerLoginFailure(
  env: Env,
  prefix: string,
  email: string,
  now: number
): Promise<void> {
  const failures = await consumeCounter(
    env.DB,
    prefix,
    { ...LOGIN_FAIL, account: email },
    now
  )
  if (failures.count >= LOGIN_FAIL_THRESHOLD) {
    await lockCounter(env.DB, prefix, lockKey(email), LOGIN_LOCK_SECONDS, now)
  }
}

authRoutes.post("/login", async (c) => {
  const body = await readJsonBody<{ email?: string; password?: string }>(c)
  const email = normalizeEmail(body?.email)
  const password = typeof body?.password === "string" ? body.password : ""
  if (!isValidEmail(email) || password.length === 0) {
    return apiError(
      c,
      400,
      "INVALID_CREDENTIALS",
      "Email and password are required"
    )
  }

  const prefix = getTablePrefix(c.env)
  const notReady = await requireInitialized(c, prefix)
  if (notReady) return notReady
  const now = nowSeconds()

  // 锁定判定排在限流之前：锁着的账号如实回「已锁定/多久后重试」，而不是被限流
  // 兜住后给一个让人摸不着头脑的 RATE_LIMITED。
  const lock = await readCounter(c.env.DB, prefix, lockKey(email))
  if (lock?.lockedUntil && lock.lockedUntil > now) {
    return apiError(
      c,
      429,
      "ACCOUNT_LOCKED",
      "Too many failed attempts; try again later",
      { retryAfter: lock.lockedUntil - now }
    )
  }

  const limit = await enforceRateLimit(c.env.DB, prefix, {
    ...LOGIN_LIMIT,
    ip: clientIp(c),
    account: email
  })
  if (!limit.allowed) return rateLimited(c, limit.retryAfter)

  const user = await findUserByEmail(c.env.DB, prefix, email)
  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH)
    await registerLoginFailure(c.env, prefix, email, now)
    return apiError(c, 401, "INVALID_CREDENTIALS", "Invalid email or password")
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    await registerLoginFailure(c.env, prefix, email, now)
    return apiError(c, 401, "INVALID_CREDENTIALS", "Invalid email or password")
  }

  if (user.status === "pending") {
    return apiError(
      c,
      403,
      "ACCOUNT_PENDING",
      "This account is waiting for administrator approval"
    )
  }
  if (user.status === "disabled") {
    return apiError(c, 403, "ACCOUNT_DISABLED", "This account is disabled")
  }

  const verificationEnforced = await emailVerificationEnforced(c.env)
  if (verificationEnforced && user.email_verified === 0) {
    return apiError(
      c,
      403,
      "EMAIL_NOT_VERIFIED",
      "Verify your email address before signing in",
      { email: user.email }
    )
  }
  if (!verificationEnforced && user.email_verified === 0) {
    // 邮件能力已撤（provider 清空/签名钥缺失）：按「未配置」口径放行并自愈标记，
    // 不把用户永久锁在「未验证」状态（规格 §5.6 第 4 条）。
    await updateUserFields(c.env.DB, prefix, user.id, { email_verified: 1 })
    user.email_verified = 1
  }

  await clearCounter(c.env.DB, prefix, { ...LOGIN_FAIL, account: email })
  await clearCounter(c.env.DB, prefix, lockKey(email))

  const twoFactor = await getTwoFactor(c.env.DB, prefix, user.id)
  const methods: string[] = []
  if (twoFactor?.totp_enabled && twoFactor.totp_secret) methods.push("totp")
  if ((await listPasskeys(c.env.DB, prefix, user.id)).length > 0) {
    methods.push("passkey")
  }

  if (methods.length > 0) {
    const secret = secretOf(c.env)
    if (!secret) return authUnavailable(c)
    const tempToken = await signTempToken(user.id, secret)
    return c.json({ requires2fa: true, tempToken, methods })
  }

  const session = await createSession(c.env.DB, prefix, user.id, {
    ip: clientIp(c),
    userAgent: c.req.header("user-agent") ?? ""
  })
  setSessionCookie(c, session.token)
  return c.json({ requires2fa: false, user: await buildUserView(c.env, user) })
})

/** 第二因子校验的公共前置：签名钥、限流、tempToken、用户状态、单次使用。 */
async function readStepUp(
  c: Ctx,
  tempToken: unknown,
  limitRule: { action: string; windowSeconds: number; max: number }
): Promise<
  | { ok: true; secret: string; userId: number; jti: string }
  | { ok: false; response: Response }
> {
  const secret = secretOf(c.env)
  if (!secret) return { ok: false, response: authUnavailable(c) }

  const prefix = getTablePrefix(c.env)
  const notReady = await requireInitialized(c, prefix)
  if (notReady) return { ok: false, response: notReady }
  const limit = await enforceRateLimit(c.env.DB, prefix, {
    ...limitRule,
    ip: clientIp(c)
  })
  if (!limit.allowed) {
    return { ok: false, response: rateLimited(c, limit.retryAfter) }
  }

  const payload = await verifyTempToken(tempToken, secret)
  if (!payload) {
    return {
      ok: false,
      response: apiError(
        c,
        401,
        "STEP_UP_REQUIRED",
        "Your sign-in session expired; enter your password again"
      )
    }
  }

  const used = await readCounter(c.env.DB, prefix, {
    action: STEP_UP_USED.action,
    account: payload.jti
  })
  if ((used?.count ?? 0) > 0) {
    return {
      ok: false,
      response: apiError(
        c,
        401,
        "STEP_UP_REQUIRED",
        "This sign-in session was already used; enter your password again"
      )
    }
  }

  const user = await findUserById(c.env.DB, prefix, payload.sub)
  if (!user) {
    return {
      ok: false,
      response: apiError(
        c,
        401,
        "STEP_UP_REQUIRED",
        "Sign-in session is invalid"
      )
    }
  }
  if (user.status === "pending") {
    return {
      ok: false,
      response: apiError(
        c,
        403,
        "ACCOUNT_PENDING",
        "Account is waiting for approval"
      )
    }
  }
  if (user.status === "disabled") {
    return {
      ok: false,
      response: apiError(c, 403, "ACCOUNT_DISABLED", "Account is disabled")
    }
  }

  return { ok: true, secret, userId: payload.sub, jti: payload.jti }
}

async function finishSignIn(
  c: Ctx,
  userId: number,
  jti: string
): Promise<Response> {
  const prefix = getTablePrefix(c.env)
  await consumeCounter(
    c.env.DB,
    prefix,
    {
      action: STEP_UP_USED.action,
      account: jti,
      windowSeconds: STEP_UP_USED.windowSeconds
    },
    nowSeconds()
  )
  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) {
    return apiError(c, 401, "STEP_UP_REQUIRED", "Sign-in session is invalid")
  }
  const session = await createSession(c.env.DB, prefix, user.id, {
    ip: clientIp(c),
    userAgent: c.req.header("user-agent") ?? ""
  })
  setSessionCookie(c, session.token)
  return c.json({ requires2fa: false, user: await buildUserView(c.env, user) })
}

authRoutes.post("/2fa/verify", async (c) => {
  const body = await readJsonBody<{
    tempToken?: string
    method?: string
    code?: string
  }>(c)
  const stepUp = await readStepUp(c, body?.tempToken, TWO_FA_LIMIT)
  if (!stepUp.ok) return stepUp.response

  if (body?.method !== "totp") {
    return apiError(c, 400, "INVALID_CODE", "Unsupported verification method")
  }

  const prefix = getTablePrefix(c.env)
  const code = typeof body.code === "string" ? body.code.trim() : ""
  const twoFactor = await getTwoFactor(c.env.DB, prefix, stepUp.userId)
  const step =
    twoFactor?.totp_enabled && twoFactor.totp_secret
      ? verifyTotpCode(twoFactor.totp_secret, code)
      : null

  if (step === null) {
    const fails = await consumeCounter(
      c.env.DB,
      prefix,
      { ...TWO_FA_FAIL_LIMIT, account: String(stepUp.userId) },
      nowSeconds()
    )
    if (fails.count > TWO_FA_FAIL_LIMIT.max) {
      return rateLimited(c, TWO_FA_FAIL_LIMIT.windowSeconds)
    }
    return apiError(c, 400, "INVALID_CODE", "Invalid verification code")
  }

  // 同一步长窗口内的同码重放拒绝（对应 eNotify 的 KV totp_used 判定）。
  const replay = await consumeCounter(
    c.env.DB,
    prefix,
    { ...TOTP_USED, account: `${stepUp.userId}:${step}` },
    nowSeconds()
  )
  if (replay.count > 1) {
    return apiError(c, 400, "INVALID_CODE", "Invalid verification code")
  }

  await clearCounter(c.env.DB, prefix, {
    ...TWO_FA_FAIL_LIMIT,
    account: String(stepUp.userId)
  })
  return finishSignIn(c, stepUp.userId, stepUp.jti)
})

// ─── 通行密钥（第二因子） ──────────────────────────────────────────────────────

authRoutes.post("/2fa/passkey/options", async (c) => {
  const body = await readJsonBody<{ tempToken?: string }>(c)
  const stepUp = await readStepUp(c, body?.tempToken, PASSKEY_LIMIT)
  if (!stepUp.ok) return stepUp.response

  const prefix = getTablePrefix(c.env)
  const passkeys = await listPasskeys(c.env.DB, prefix, stepUp.userId)
  if (passkeys.length === 0) {
    return apiError(c, 400, "PASSKEY_NOT_ENABLED", "No passkey is registered")
  }

  const options = await createAuthenticationOptions({
    rp: relyingParty(c),
    allowCredentialIds: passkeys.map((passkey) => passkey.credential_id)
  })
  await setChallengeCookie(c, stepUp.secret, options.challenge, "authenticate")
  return c.json(options)
})

authRoutes.post("/2fa/passkey/verify", async (c) => {
  const body = await readJsonBody<{
    tempToken?: string
    credential?: unknown
    response?: unknown
  }>(c)
  const stepUp = await readStepUp(c, body?.tempToken, PASSKEY_LIMIT)
  if (!stepUp.ok) return stepUp.response

  const challenge = await readChallengeCookie(c, stepUp.secret, "authenticate")
  if (!challenge) {
    return apiError(
      c,
      400,
      "PASSKEY_CHALLENGE_MISSING",
      "No pending passkey challenge; request options again"
    )
  }

  const prefix = getTablePrefix(c.env)
  // `credential` 是前端契约字段；`response` 是 @simplewebauthn 的原名，兼容保留。
  const response = (body?.credential ?? body?.response) as
    | { id?: unknown }
    | undefined
  const credentialId = typeof response?.id === "string" ? response.id : ""
  const passkey = credentialId
    ? await findPasskeyByCredentialId(
        c.env.DB,
        prefix,
        stepUp.userId,
        credentialId
      )
    : null
  if (!passkey) {
    clearChallengeCookie(c)
    return apiError(c, 400, "PASSKEY_FAILED", "Unknown passkey credential")
  }

  const verdict = await verifyAuthentication({
    response,
    expectedChallenge: challenge,
    rp: relyingParty(c),
    credential: {
      id: passkey.credential_id,
      publicKey: passkey.public_key,
      counter: passkey.counter
    }
  })
  clearChallengeCookie(c)
  if (!verdict.verified) {
    return apiError(c, 401, "PASSKEY_FAILED", "Passkey verification failed")
  }

  await touchPasskey(c.env.DB, prefix, passkey.id, verdict.newCounter)
  return finishSignIn(c, stepUp.userId, stepUp.jti)
})

// ─── 登出 ─────────────────────────────────────────────────────────────────────

authRoutes.post("/logout", async (c) => {
  const token = readSessionToken(c)
  if (token) {
    const prefix = getTablePrefix(c.env)
    const session = await findSession(c.env.DB, prefix, token)
    if (session) await revokeSession(c.env.DB, prefix, session.sessionId)
  }
  clearSessionCookie(c)
  return c.json({ success: true })
})

// ─── 注册邮箱验证码 ───────────────────────────────────────────────────────────

authRoutes.post("/email/verify", async (c) => {
  const body = await readJsonBody<{ email?: string; code?: string }>(c)
  const email = normalizeEmail(body?.email)
  const code = typeof body?.code === "string" ? body.code.trim() : ""
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return apiError(c, 400, "INVALID_CODE", "Invalid or expired code")
  }
  if (!secretOf(c.env)) return authUnavailable(c)

  const prefix = getTablePrefix(c.env)
  const notReady = await requireInitialized(c, prefix)
  if (notReady) return notReady
  const limit = await enforceRateLimit(c.env.DB, prefix, {
    ...EMAIL_VERIFY_LIMIT,
    ip: clientIp(c)
  })
  if (!limit.allowed) return rateLimited(c, limit.retryAfter)

  const verdict = await verifyVerificationCode(c.env, {
    email,
    purpose: "register_verify",
    code
  })
  if (!verdict.ok) {
    return apiError(c, 400, "INVALID_CODE", "Invalid or expired code")
  }

  const user = await findUserByEmail(c.env.DB, prefix, email)
  if (user && user.email_verified === 0) {
    await updateUserFields(c.env.DB, prefix, user.id, { email_verified: 1 })
  }
  return c.json({ success: true })
})

authRoutes.post("/email/resend", async (c) => {
  const body = await readJsonBody<{ email?: string }>(c)
  const email = normalizeEmail(body?.email)
  if (!isValidEmail(email)) {
    return apiError(c, 400, "INVALID_EMAIL", "Invalid email address")
  }
  if (!secretOf(c.env)) return authUnavailable(c)
  if (!(await isEmailConfigured(c.env))) {
    return apiError(
      c,
      503,
      "EMAIL_NOT_CONFIGURED",
      "Email delivery is not configured on this site"
    )
  }

  const prefix = getTablePrefix(c.env)
  const notReady = await requireInitialized(c, prefix)
  if (notReady) return notReady
  const limit = await enforceRateLimit(c.env.DB, prefix, {
    ...EMAIL_RESEND_LIMIT,
    ip: clientIp(c)
  })
  if (!limit.allowed) return rateLimited(c, limit.retryAfter)

  const cooldown = await checkResendCooldown(c.env, {
    email,
    purpose: "register_verify"
  })
  if (!cooldown.allowed) {
    return apiError(
      c,
      429,
      "CODE_COOLDOWN",
      "Please wait before requesting another code",
      { retryAfter: cooldown.retryAfter }
    )
  }

  const user = await findUserByEmail(c.env.DB, prefix, email)
  // 防枚举：不存在、已验证、已停用都回同一个 200，且不发信。
  if (!user || user.email_verified === 1 || user.status === "disabled") {
    return c.json({ success: true })
  }

  await sendVerificationCode(c.env, {
    email,
    purpose: "register_verify",
    language: normalizeLanguage(user.language) ?? "zh"
  })
  return c.json({ success: true })
})

// ─── 找回密码 ────────────────────────────────────────────────────────────────

authRoutes.post("/password/forgot", async (c) => {
  const body = await readJsonBody<{ email?: string; language?: string }>(c)
  const email = normalizeEmail(body?.email)
  if (!isValidEmail(email)) {
    return apiError(c, 400, "INVALID_EMAIL", "Invalid email address")
  }
  // 邮件不可用就直接说清楚：登录页不会显示入口，这里仍是防呆。
  if (!(await isEmailConfigured(c.env))) {
    return apiError(
      c,
      503,
      "EMAIL_NOT_CONFIGURED",
      "Email delivery is not configured; password recovery is unavailable"
    )
  }
  if (!secretOf(c.env)) return authUnavailable(c)

  const language = normalizeLanguage(body?.language) ?? "zh"
  const prefix = getTablePrefix(c.env)
  const notReady = await requireInitialized(c, prefix)
  if (notReady) return notReady
  const limit = await enforceRateLimit(c.env.DB, prefix, {
    ...FORGOT_LIMIT,
    ip: clientIp(c)
  })
  if (!limit.allowed) return rateLimited(c, limit.retryAfter)

  const cooldown = await checkResendCooldown(c.env, {
    email,
    purpose: "password_reset"
  })
  if (!cooldown.allowed) {
    return apiError(
      c,
      429,
      "CODE_COOLDOWN",
      "Please wait before requesting another code",
      { retryAfter: cooldown.retryAfter }
    )
  }

  const user = await findUserByEmail(c.env.DB, prefix, email)
  // 防枚举：账号不存在/已停用也回同一个 200、同一文案。
  if (!user || user.status === "disabled") {
    return c.json({ success: true })
  }

  await sendVerificationCode(c.env, {
    email,
    purpose: "password_reset",
    language
  })
  return c.json({ success: true })
})

authRoutes.post("/password/reset", async (c) => {
  const body = await readJsonBody<{
    email?: string
    code?: string
    newPassword?: string
  }>(c)
  const email = normalizeEmail(body?.email)
  const code = typeof body?.code === "string" ? body.code.trim() : ""
  const newPassword =
    typeof body?.newPassword === "string" ? body.newPassword : ""
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return apiError(c, 400, "INVALID_CODE", "Invalid or expired code")
  }
  if (newPassword.length < 8) {
    return apiError(
      c,
      400,
      "WEAK_PASSWORD",
      "Password must be at least 8 characters"
    )
  }
  if (!secretOf(c.env)) return authUnavailable(c)

  const prefix = getTablePrefix(c.env)
  const notReady = await requireInitialized(c, prefix)
  if (notReady) return notReady
  const limit = await enforceRateLimit(c.env.DB, prefix, {
    ...RESET_LIMIT,
    ip: clientIp(c)
  })
  if (!limit.allowed) return rateLimited(c, limit.retryAfter)

  const verdict = await verifyVerificationCode(c.env, {
    email,
    purpose: "password_reset",
    code
  })
  if (!verdict.ok) {
    return apiError(c, 400, "INVALID_CODE", "Invalid or expired code")
  }

  const user = await findUserByEmail(c.env.DB, prefix, email)
  if (!user || user.status === "disabled") {
    return apiError(c, 400, "INVALID_CODE", "Invalid or expired code")
  }

  await updateUserFields(c.env.DB, prefix, user.id, {
    password_hash: await hashPassword(newPassword)
  })
  await revokeAllSessions(c.env.DB, prefix, user.id)
  return c.json({ success: true })
})
