import { EncryptedMessage } from '@credo-ts/core'

export interface CustomQueuedMessage {
  connectionId: string
  encryptedMessage: EncryptedMessage
  recipientKeys: string[]
  created_at: Date
  receivedAt?: Date | undefined
  state?: string
}

export interface CustomLiveSession {
  connectionId: string
  sessionid: string
  instance: string
  created_at: Date
}
