import fetch, { Headers, Request, Response } from 'node-fetch'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny = globalThis as any

if (!globalAny.fetch) {
  globalAny.fetch = fetch
}

globalAny.Headers = Headers
globalAny.Request = Request
globalAny.Response = Response
