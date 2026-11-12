import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { currentLanguage } from "@/i18n"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { PendingUser } from "@/lib/api-types"
import { intlLocale } from "@/lib/language"

/** 系统管理 · 待批准用户（审核开关的执行入口）。 */
export function UsersSection() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const result = await adminApi.pendingUsers()
      setUsers(result.items)
    } catch (loadError) {
      setError(describeApiError(t, loadError))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (user: PendingUser, action: "approve" | "reject") => {
    setBusyId(user.id)
    setError("")
    try {
      if (action === "approve") await adminApi.approveUser(user.id)
      else await adminApi.rejectUser(user.id)
      toast.success(
        t(
          action === "approve" ? "admin.users.approved" : "admin.users.rejected"
        )
      )
      await load()
    } catch (actionError) {
      setError(describeApiError(t, actionError))
    } finally {
      setBusyId(null)
    }
  }

  const formatDate = (value: string) =>
    new Date(value).toLocaleString(intlLocale(currentLanguage()))

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h3 className="font-heading text-sm font-semibold">
        {t("admin.users.title")}
      </h3>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.users.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common.email")}</TableHead>
              <TableHead className="hidden sm:table-cell">
                {t("admin.users.displayName")}
              </TableHead>
              <TableHead className="text-right">
                {t("admin.users.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="max-w-48 truncate">
                  <div className="flex flex-col">
                    <span className="truncate">{user.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("admin.users.requestedAt", {
                        date: formatDate(user.createdAt)
                      })}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {user.displayName}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === user.id}
                      onClick={() => void act(user, "approve")}
                    >
                      {t("admin.users.approve")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === user.id}
                      onClick={() => void act(user, "reject")}
                    >
                      {t("admin.users.reject")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
