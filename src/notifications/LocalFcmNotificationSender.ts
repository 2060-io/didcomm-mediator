import type { App as FcmApp } from 'firebase-admin/app'
import firebaseAdmin from 'firebase-admin'
import path from 'path'
import { fileURLToPath } from 'url'
import { Logger } from '@credo-ts/core'
import { FcmNotificationSender } from './FcmNotificationSender.js'
import { FIREBASE_CFG_FILE } from '../config/constants.js'

export class LocalFcmNotificationSender implements FcmNotificationSender {
  private fcmApp: FcmApp | null = null
  private logger?: Logger

  public constructor(logger?: Logger) {
    this.logger = logger

    try {
      const baseDir = path.dirname(fileURLToPath(import.meta.url))
      const configPath = path.isAbsolute(FIREBASE_CFG_FILE)
        ? FIREBASE_CFG_FILE
        : path.resolve(baseDir, '..', '..', FIREBASE_CFG_FILE)
      this.fcmApp = firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(configPath),
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
      const response = await firebaseAdmin.messaging(this.fcmApp).send({
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
