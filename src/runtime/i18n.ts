// Translations for mods.
//
// Slack ships in a lot of languages and a mod that only speaks English sticks
// out inside it. This is the smallest thing that fixes that: a mod hands over
// one object of dictionaries and gets back a lookup function.
//
// Where the language comes from: `<html lang>`, which Slack sets to the user's
// chosen interface language ("fr-FR" on a French client), with the browser's
// own preference as a fallback for the moment before Slack has set it. It is
// deliberately not read from `localConfig_v2` -- that is the file holding the
// session token, and only web-api.ts may touch it.
//
// English is required and is the fallback, because it is the language this
// repository is written and reviewed in. A missing key falls back the same way
// rather than rendering blank: a mod in the wrong language is a nuisance, a mod
// showing nothing is a bug report.

export type Dictionary = Record<string, string>;

export interface Tables<T extends Dictionary> {
  /** Required: the fallback for every other language, and for missing keys. */
  en: T;
  [language: string]: Partial<T> | T;
}

export type Translate<T extends Dictionary> = (
  key: keyof T & string,
  vars?: Record<string, string | number>,
) => string;

export interface I18n {
  /** The app's language tag, e.g. "fr-FR". Use it for toLocaleString and friends. */
  readonly locale: string;
  /** Its primary subtag, e.g. "fr". This is what dictionaries are keyed by. */
  readonly language: string;
  /**
   * Build a translator.
   *
   *   const t = api.i18n.strings({
   *     en: { members: 'Members', online: '{count} online' },
   *     fr: { members: 'Membres', online: '{count} en ligne' },
   *   });
   *   t('online', { count: 3 });
   *
   * Lookup goes exact locale ("fr-CA"), then language ("fr"), then English.
   */
  strings<T extends Dictionary>(tables: Tables<T>): Translate<T>;
}

/** Slack's interface language, as a BCP 47 tag. */
export function detectLocale(): string {
  /*
   * `documentElement` can genuinely be null here. The runtime is injected at
   * document-start, before Slack's own markup exists, and reading `lang` off
   * nothing threw -- which took the whole bundle down at evaluation, so the
   * document-start injection failed every single boot and the mods only ever
   * arrived through the loader's re-injection fallback. That is the "runtime
   * went missing after a navigation, re-injecting" line in the terminal, and
   * it is also the half-built DOM the two renderer freezes came from.
   */
  const declared = document.documentElement?.getAttribute('lang');
  if (declared && declared.trim()) return declared.trim();
  return navigator.language || 'en';
}

/** `{name}` placeholders, replaced from `vars`. Unknown ones are left alone. */
function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole);
}

export function createI18n(locale = detectLocale()): I18n {
  const language = locale.split(/[-_]/)[0]!.toLowerCase();

  return {
    locale,
    language,
    strings<T extends Dictionary>(tables: Tables<T>): Translate<T> {
      // Resolved once per translator rather than per call: the language cannot
      // change without Slack reloading, which takes the mod with it.
      const exact = (tables[locale] ?? tables[locale.replace('_', '-')]) as Partial<T> | undefined;
      const byLanguage = tables[language] as Partial<T> | undefined;

      return (key, vars) => {
        const value = exact?.[key] ?? byLanguage?.[key] ?? tables.en[key];
        // A key missing everywhere is a mistake in the mod, not something the
        // user should see as an empty gap; showing the key names it.
        return interpolate(value ?? key, vars);
      };
    },
  };
}
