export interface SanitizedUrl {
  url: string
  domain: string
}

export function sanitizeUrl(raw: string | null | undefined): SanitizedUrl | null {
  if (!raw) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const domain = parsed.hostname.replace(/^www\./, '')
  if (!domain) return null

  return { url: domain, domain }
}
