/**
 * Lightweight markdown normalizer for small local models.
 * Fixes common malformations without inventing content or removing spaces.
 */

export function normalizeMarkdown(src: string): string {
  let text = String(src || '')
  // Fix ###1. / ##1. glued headings
  text = text.replace(/^(#{1,6})(\d+)/gm, '$1 $2')
  text = text.replace(/^(#{1,6})([A-Za-z])/gm, '$1 $2')
  // Fix **Install glued
  text = text.replace(/\*\*([^*\n]+)\*\*/g, (_, inner: string) => `**${inner.trim()}**`)
  // Ensure blank line before headings when glued to previous text
  text = text.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
  // Numbered lists: "1.Foo" → "1. Foo"
  text = text.replace(/^(\d+\.)([^\s\d])/gm, '$1 $2')
  // Bullet glue: "-Foo" → "- Foo"
  text = text.replace(/^([*-])([^\s*-])/gm, '$1 $2')
  return text
}

/** Strip raw tool-protocol / NDJSON lines that leak into answers */
export function stripProtocolNoise(src: string): string {
  return String(src || '')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/^\{"name"\s*:/.test(t)) return false
      if (/^\{"type"\s*:\s*"(tool|function)"/.test(t)) return false
      if (/^data:\s*\{/.test(t)) return false
      return true
    })
    .join('\n')
}
