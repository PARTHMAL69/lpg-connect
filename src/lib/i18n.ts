import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "@/locales/en";
import hi from "@/locales/hi";
import mr from "@/locales/mr";

let initialized = false;
export function initI18n() {
  if (initialized) return i18n;
  initialized = true;
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        hi: { translation: hi },
        mr: { translation: mr },
      },
      fallbackLng: "en",
      supportedLngs: ["en", "hi", "mr"],
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
        lookupLocalStorage: "lpg.lang",
      },
    });
  return i18n;
}

export default i18n;
