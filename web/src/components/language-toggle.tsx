import { LanguagesIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { changeLanguage } from "@/i18n"
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  type Language,
  SUPPORTED_LANGUAGES
} from "@/lib/language"

interface LanguagePickerProps {
  /** 交给调用方接管写回（设置页要同步账号）；不传则只改本机选择。 */
  onChange?: (language: Language) => void
  disabled?: boolean
}

/** 当前语言与切换动作；语言状态读 i18next，选项由支持集驱动。 */
function useLanguageChoice(onChange?: (language: Language) => void) {
  const { i18n } = useTranslation()
  const value = i18n.resolvedLanguage ?? i18n.language
  const current = isLanguage(value) ? value : DEFAULT_LANGUAGE
  return {
    current,
    select: (next: Language) => {
      if (next === current) return
      if (onChange) {
        // 立即生效，然后由调用方写回账号；写回失败也不回滚界面语言。
        void changeLanguage(next)
        onChange(next)
      } else {
        void changeLanguage(next)
      }
    }
  }
}

/** 设置页里的语言选择。 */
export function LanguageSegmented({ onChange, disabled }: LanguagePickerProps) {
  const { t } = useTranslation()
  const { current, select } = useLanguageChoice(onChange)

  return (
    <ToggleGroup
      type="single"
      value={current}
      disabled={disabled}
      onValueChange={(value) => {
        if (isLanguage(value)) select(value)
      }}
      aria-label={t("common.language")}
    >
      {SUPPORTED_LANGUAGES.map((language) => (
        <ToggleGroupItem key={language} value={language} size="sm">
          {t(`common.languages.${language}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** 未登录页与顶栏的快捷切换：按支持集循环。 */
export function LanguageCycleButton({ onChange }: LanguagePickerProps) {
  const { t } = useTranslation()
  const { current, select } = useLanguageChoice(onChange)
  const label = t("common.languages.switch", {
    language: t(`common.languages.${current}`)
  })

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onClick={() => {
        const index = SUPPORTED_LANGUAGES.indexOf(current)
        select(SUPPORTED_LANGUAGES[(index + 1) % SUPPORTED_LANGUAGES.length])
      }}
    >
      <LanguagesIcon aria-hidden="true" />
    </Button>
  )
}
