/**
 * Derive a default shorten base URL (origin) from a public did:web or did:webvh.
 * Example: did:web:example.com -> https://example.com
 * Example: did:web:sub.domain.tld:foo:bar -> https://sub.domain.tld
 * Example: did:webvh:<scid>:example.com -> https://example.com
 * Example: did:webvh:example.com -> https://example.com (the SCID-less form the mediator accepts in its config)
 * Example: did:web:localhost%3A4000 -> https://localhost:4000
 */
export async function deriveShortenBaseFromPublicDid(publicDid?: string): Promise<string | undefined> {
  if (!publicDid) return undefined

  let host: string | undefined
  if (publicDid.startsWith('did:web:')) {
    host = publicDid.substring('did:web:'.length).split(':')[0]
  } else if (publicDid.startsWith('did:webvh:')) {
    // Same rule as the mediator uses for its own domain: did:webvh:<scid>:<domain> or did:webvh:<domain>
    const parts = publicDid.substring('did:webvh:'.length).split(':')
    host = parts.length > 1 ? parts[1] : parts[0]
  }
  if (!host) return undefined

  // A port is percent-encoded in did:web and did:webvh
  return `https://${decodeURIComponent(host)}`
}
