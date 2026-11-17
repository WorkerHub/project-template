/**
 * PWA 安装清单（规格第 4 项）：断言 /manifest.webmanifest 由身份真源生成、
 * 字段完整、图标齐全，且未被 SPA 回落吞掉（assets 替身只对 `/` 回 HTML，
 * 若路由未注册，请求会拿到 HTML 使断言失败）。
 */
import { describe, expect, it } from "vitest"
import { PROJECT_NAME } from "../src/config/project"
import { makeContext, request } from "./support/app"

describe("PWA 安装清单", () => {
  it("GET /manifest.webmanifest：由真源生成，含完整安装字段与图标", async () => {
    const { env } = makeContext()
    const res = await request(env, "/manifest.webmanifest")

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain(
      "application/manifest+json"
    )
    expect(res.headers.get("cache-control")).toBe("public, max-age=60")

    const body = JSON.parse(await res.text()) as Record<string, unknown>
    expect(body).toMatchObject({
      id: "/",
      name: PROJECT_NAME,
      short_name: PROJECT_NAME,
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff"
    })
    expect(String(body.description).length).toBeGreaterThan(0)
    expect(body.icons).toEqual([
      { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ])
  })
})
