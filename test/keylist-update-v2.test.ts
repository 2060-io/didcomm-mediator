import { jest } from '@jest/globals'
import { didKeyToVerkey } from '@credo-ts/core'
import {
  DidCommKeylistUpdateV2Message,
  DidCommMediatorService,
  KeylistUpdateActionV2,
  KeylistUpdateResultV2,
} from '@credo-ts/didcomm'

// The did:keys that a DIDComm v2 mediatee registers for a new connection: one Ed25519 key and one X25519 key.
const ED25519_DID_KEY = 'did:key:z6Mkk5MA1CHPqnzvuCkrnevzvMJFJ5fXoYJjDNf6dn5i9Xf7'
const X25519_DID_KEY = 'did:key:z6LSrxSLdK2MGB1kWYtJgNb7oVmLEN89Tniy39EqxVUncbGv'

const setup = (otherMediationRecord?: { id: string }) => {
  const mediationRecord = {
    id: 'mediation-1',
    protocolVersion: 'v2',
    assertReady: () => undefined,
    assertRole: () => undefined,
    addRecipientDid: jest.fn(),
    removeRecipientDid: jest.fn(),
  }
  const mediationRepository = {
    getByConnectionId: jest.fn(async () => mediationRecord),
    findByQuery: jest.fn(async () => (otherMediationRecord ? [otherMediationRecord] : [])),
    update: jest.fn(async () => undefined),
  }
  const service = new DidCommMediatorService(
    mediationRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  )
  const message = new DidCommKeylistUpdateV2Message({
    updates: [
      { recipientDid: ED25519_DID_KEY, action: KeylistUpdateActionV2.add },
      { recipientDid: X25519_DID_KEY, action: KeylistUpdateActionV2.add },
    ],
  })
  const agentContext = {}
  const messageContext = { message, agentContext, assertReadyConnection: () => ({ id: 'connection-1' }) }

  return { service, mediationRecord, mediationRepository, messageContext, agentContext }
}

describe('keylist update 2.0', () => {
  it('answers an update that adds an X25519 did:key', async () => {
    const { service, mediationRecord, mediationRepository, messageContext, agentContext } = setup()

    const response = await service.processKeylistUpdateV2(messageContext as never)

    expect(response.updated.map((update) => [update.recipientDid, update.result])).toEqual([
      [ED25519_DID_KEY, KeylistUpdateResultV2.Success],
      [X25519_DID_KEY, KeylistUpdateResultV2.Success],
    ])
    expect(mediationRecord.addRecipientDid).toHaveBeenCalledWith(X25519_DID_KEY)
    // Only the Ed25519 did:key has a verkey, so only that key is also checked in the v1 key index.
    expect(mediationRepository.findByQuery).toHaveBeenCalledWith(
      agentContext,
      { recipientKeys: [didKeyToVerkey(ED25519_DID_KEY)] },
      { limit: 1 }
    )
    expect(mediationRepository.findByQuery).toHaveBeenCalledWith(
      agentContext,
      { recipientDids: [X25519_DID_KEY] },
      { limit: 1 }
    )
    expect(mediationRepository.findByQuery).toHaveBeenCalledTimes(3)
  })

  it('still refuses keys that another mediatee registered', async () => {
    const { service, mediationRecord, messageContext } = setup({ id: 'mediation-2' })

    const response = await service.processKeylistUpdateV2(messageContext as never)

    expect(response.updated.map((update) => update.result)).toEqual([
      KeylistUpdateResultV2.ClientError,
      KeylistUpdateResultV2.ClientError,
    ])
    expect(mediationRecord.addRecipientDid).not.toHaveBeenCalled()
  })
})
