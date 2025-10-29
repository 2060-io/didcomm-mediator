/**
 * Derive a default shorten base URL (origin) from a public DID when using did:web.
 * Example: did:web:example.com -> https://example.com
 * Example: did:web:sub.domain.tld:foo:bar -> https://sub.domain.tld
 */
export async function deriveShortenBaseFromPublicDid(publicDid?: string): Promise<string | undefined> {
  if (!publicDid) return undefined
  if (!publicDid.startsWith('did:web:')) return undefined
  const rest = publicDid.substring('did:web:'.length)
  const parts = rest.split(':')
  const host = parts[0]
  if (!host) return undefined

  return `https://${host}`
}
