const RU_TO_EN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

/**
 * Transliterates Cyrillic Russian text into a clean URL-friendly and ID-friendly slug.
 * Example: 'Иудейская Автономия' -> 'iudeyskaya-avtonomiya'
 */
export function transliterateToSlug(text: string): string {
  const lower = text.trim().toLowerCase()
  let result = ''
  for (const char of lower) {
    if (RU_TO_EN[char] !== undefined) {
      result += RU_TO_EN[char]
    } else if (/[a-z0-9]/.test(char)) {
      result += char
    } else if (/[\s\-_.,/]/.test(char)) {
      if (result.length > 0 && result[result.length - 1] !== '-') {
        result += '-'
      }
    }
  }
  return result.replace(/^-+|-+$/g, '')
}
