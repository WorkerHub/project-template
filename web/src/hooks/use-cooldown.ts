import { useEffect, useState } from "react"

/**
 * 重发/限流倒计时：秒数归零前按钮不可点。
 *
 * 服务端会在响应（或 429）里给冷却秒数，页面用 `start(seconds)` 起步；
 * 计时只负责显示，不替服务端做判定。
 */
export function useCooldown() {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  return {
    seconds,
    running: seconds > 0,
    start: (value: number) => setSeconds(Math.max(0, Math.ceil(value)))
  }
}
