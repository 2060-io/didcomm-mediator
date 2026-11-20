import { deriveShortenBaseFromPublicDid } from '../src/util/invitationBase'

describe('deriveShortenBaseFromPublicDid', () => {
  it.each([
    ['did:web:ca.2060.io', 'https://ca.2060.io'],
    ['did:web:sub.domain.tld:foo:bar', 'https://sub.domain.tld'],
    ['did:web:localhost%3A4000', 'https://localhost:4000'],
    ['did:webvh:ca.dev.2060.io', 'https://ca.dev.2060.io'],
    ['did:webvh:QmdDdSAyNAAaCVtTKK1STvHNdBLnhR2dYjxc6W2ZuS6gNk:ca.dev.2060.io', 'https://ca.dev.2060.io'],
    ['did:webvh:QmdDdSAyNAAaCVtTKK1STvHNdBLnhR2dYjxc6W2ZuS6gNk:localhost%3A4000', 'https://localhost:4000'],
  ])('derives the base of %s', async (did, base) => {
    expect(await deriveShortenBaseFromPublicDid(did)).toBe(base)
  })

  it.each([undefined, '', 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', 'did:web:'])(
    'derives nothing from %s',
    async (did) => {
      expect(await deriveShortenBaseFromPublicDid(did)).toBeUndefined()
    }
  )
})
