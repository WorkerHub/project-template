import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <Button asChild variant="outline">
        <Link to="/">{t("common.home")}</Link>
      </Button>
    </div>
  )
}
