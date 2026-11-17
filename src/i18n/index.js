/*
  Interface translations (i18next + react-i18next).

  Each file in ./resources is one namespace and exports { en, hi, ar, 'zh-CN', es, fr }.
  English is the fallback for any missing key, so a partly translated namespace
  still reads correctly. Business records (supplier names, shipment references,
  product identifiers, API values) are data and are never passed through t().
*/
import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import { onLanguagePref } from '../state/viewPrefs.js'

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', dir: 'ltr', locale: 'en-CA' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', dir: 'ltr', locale: 'hi-IN' },
  { code: 'ar', label: 'Arabic', native: 'العربية', dir: 'rtl', locale: 'ar' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', native: '简体中文', dir: 'ltr', locale: 'zh-CN' },
  { code: 'es', label: 'Spanish', native: 'Español', dir: 'ltr', locale: 'es' },
  { code: 'fr', label: 'French', native: 'Français', dir: 'ltr', locale: 'fr-CA' },
]

export const languageOf = (code) => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]

const modules = import.meta.glob('./resources/*.js', { eager: true })
const resources = {}
for (const [path, mod] of Object.entries(modules)) {
  const ns = path.match(/([\w-]+)\.js$/)[1]
  for (const [lang, strings] of Object.entries(mod.default)) (resources[lang] ??= {})[ns] = strings
}
export const NAMESPACES = Object.keys(resources.en ?? {})

i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  ns: NAMESPACES,
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
  react: { useSuspense: false },
})

// The saved display language drives i18next. Changing it in Settings re-renders every translated screen.
onLanguagePref((code) => {
  if (i18n.language !== code) i18n.changeLanguage(code)
})

/** The active locale for dates, numbers and currency. Values never change, only their formatting. */
export const activeLocale = () => languageOf(i18n.language).locale
export const isRtl = () => languageOf(i18n.language).dir === 'rtl'

export function formatNumber(value, options) {
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat(activeLocale(), options).format(Number(value)) : ''
}
export function formatDateTime(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(activeLocale(), options).format(d)
}

export { useTranslation }
export default i18n
