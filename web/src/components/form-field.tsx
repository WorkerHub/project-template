import type { ReactNode } from "react"
import { Label } from "@/components/ui/label"

/**
 * 表单一行：Label + 控件 + 错误文案。控件自身负责 aria-invalid / aria-describedby
 * 所需的 id；这里只统一间距与错误样式，避免每个页面各写一套。
 */
export function Field({
  id,
  label,
  error,
  hint,
  children
}: {
  id: string
  label: ReactNode
  error?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
