import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { Me } from "@/lib/api-types"
import { accountInitial } from "@/lib/user-identity"

type UserAvatarProps = {
  user: Pick<Me, "displayName" | "email"> | null
  className?: string
}

/** 首字圆头像：尺寸由调用方给（顶栏触发 `size-7`、下拉身份块 `size-9`）。 */
export function UserAvatar({ user, className }: UserAvatarProps) {
  return (
    <Avatar className={className}>
      <AvatarFallback className="bg-muted text-xs font-medium text-foreground">
        {accountInitial(user)}
      </AvatarFallback>
    </Avatar>
  )
}
