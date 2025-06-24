import { initializeApp, App as FcmApp } from 'firebase-admin/app'
import { credential } from 'firebase-admin'
import { getMessaging } from 'firebase-admin/messaging'
import path from 'path'
import { Logger } from '@credo-ts/core'
import { FcmNotificationSender } from './FcmNotificationSender'
import { FIREBASE_CFG_FILE } from '../config/constants'

export class LocalFcmNotificationSender implements FcmNotificationSender {
  private fcmApp: FcmApp | null = null
  private logger?: Logger

  public constructor(logger?: Logger) {
    this.logger = logger

    try {
      const configPath = path.resolve(__dirname, FIREBASE_CFG_FILE)
      this.fcmApp = initializeApp({
        credential: credential.cert(configPath),
      })
      this.logger?.debug('[LocalFcmNotificationSender] Firebase-admin initialized successfully')
    } catch (error) {
      this.logger?.warn(
        '[LocalFcmNotificationSender] Failed to initialize Firebase Admin. Notifications will be disabled:',
        error.message
      )
      this.fcmApp = null
    }
  }

  public async sendMessage(registrationToken: string, messageId: string) {
    try {
      if (!this.fcmApp) {
        this.logger?.warn('Firebase Admin is not initialized. Skipping notification.')
        return false
      }
      const response = await getMessaging(this.fcmApp).send({
        token: registrationToken,
        notification: {
          title: 'Hologram',
          body: 'You have new messages',
        },
        data: {
          '@type': 'https://didcomm.org/push-notifications-fcm',
          message_id: messageId,
        },
        android: {
          collapseKey: 'generic-new-messages',
          priority: 'high',
          notification: { tag: 'generic-new-messages', icon: 'ic_notification' },
        },
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-collapse-id': 'generic-new-messages',
          },
          payload: { aps: { contentAvailable: true } },
        },
      })
      this.logger?.debug(`Message sent successfully: ${response}`)
      return true
    } catch (error) {
      this.logger?.error('Error while sending notification:', error.message)
      return false
    }
  }

  public isInitialized(): boolean {
    return this.fcmApp !== null
  }
}
