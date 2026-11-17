/**
 * 导出 PWA 图标（规格第 4 项）：把 site-logo.tsx 的菱形环光栅化为四枚 PNG，
 * 随仓提交到 web/public/icons/。
 *
 * 几何与颜色唯一真源是 web/src/components/site-logo.tsx：
 * - viewBox 0 0 24 24，外菱半径 9.5、内菱半径 3.4（|dx|+|dy| 判据，evenodd 成环）
 * - 颜色取亮色主题前景（oklch(0.145 0 0) ≈ #0a0a0a）配 #ffffff 底，与 index.html
 *   主题对字面量一致。
 *
 * 零依赖：PNG 用 node:zlib 压缩、表驱动 CRC32 手工拼块，不引入图像库。
 * Logo 变更后重跑 `node scripts/export-pwa-icons.mjs` 并提交新 PNG。
 */
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const OUT_DIR = path.resolve(import.meta.dirname, "..", "web/public/icons")

/** 前景（菱形）#0a0a0a / 底 #ffffff */
const FG = [10, 10, 10]
const BG = [255, 255, 255]

const TARGETS = [
  ["pwa-192.png", 192],
  ["pwa-512.png", 512],
  ["pwa-maskable-512.png", 512],
  ["apple-touch-icon.png", 180]
]

// ---- CRC32（zlib 多项式 0xEDB88320，表驱动）----
const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** 编码为 RGB 8bit PNG（每行 filter 0，IHDR/IDAT/IEND 三块）。 */
function encodePng(size, rgb) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0) // width
  ihdr.writeUInt32BE(size, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  const stride = size * 3
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ])
}

/** 光栅化菱形环（8×8 超采样抗锯齿），与 site-logo.tsx 路径一致。 */
function raster(size) {
  const buf = Buffer.alloc(size * size * 3)
  const center = size / 2
  const rOut = (9.5 / 24) * size
  const rIn = (3.4 / 24) * size
  const SS = 8
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        const py = y + (sy + 0.5) / SS - center
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - center
          const d = Math.abs(px) + Math.abs(py)
          if (d <= rOut && d > rIn) hits++
        }
      }
      const a = hits / (SS * SS)
      const i = (y * size + x) * 3
      buf[i] = Math.round(BG[0] + (FG[0] - BG[0]) * a)
      buf[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a)
      buf[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a)
    }
  }
  return buf
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, size] of TARGETS) {
  const png = encodePng(size, raster(size))
  writeFileSync(path.join(OUT_DIR, name), png)
  console.log(
    `生成 ${name}（${size}x${size}，${(png.length / 1024).toFixed(1)} KB）`
  )
}
