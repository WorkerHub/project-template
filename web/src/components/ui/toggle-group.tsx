"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

/**
 * ToggleGroup（shadcn/Nova 风格包装 radix-ui 原生 ToggleGroup）。
 *
 * 只做视觉包装与尺寸变体，行为全部交给 Radix：`type="single"` 时是单选组，
 * 再点一次当前项 Radix 会回调空串（取消选中）—— 需要「必须有一项选中」的调用方
 * 自己在 onValueChange 里忽略空串（见 components/scene-switcher.tsx）。
 *
 * 不新增依赖：`radix-ui` 已是现有依赖（统一入口），这里不引 @radix-ui/react-toggle-group。
 */
function ToggleGroup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        "group/toggle-group flex w-fit items-center gap-1",
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  )
}

const toggleGroupItemVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default: "h-8 px-2.5",
        sm: "h-7 px-2",
        lg: "h-9 px-2.5"
      }
    },
    defaultVariants: {
      size: "default"
    }
  }
)

function ToggleGroupItem({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem, toggleGroupItemVariants }
