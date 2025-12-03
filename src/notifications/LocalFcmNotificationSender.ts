import { initializeApp, App as FcmApp } from 'firebase-admin/app'
import { credential } from 'firebase-admin'
import { getMessaging, Message } from 'firebase-admin/messaging'
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

  /**
   * Sends an FCM notification (either visible or silent) to the given device token.
   *
   * @param registrationToken - FCM device token
   * @param messageId - Unique message identifier
   * @param silent - If true, sends a silent (data-only) notification. Defaults to false (visible).
   * @returns Promise resolving to true if successful, false otherwise
   */
  public async sendMessage(registrationToken: string, messageId: string, silent = false): Promise<boolean> {
    try {
      if (!this.fcmApp) {
        this.logger?.warn('Firebase Admin is not initialized. Skipping notification.')
        return false
      }

      const message: Message = {
        token: registrationToken,
        data: {
          '@type': 'https://didcomm.org/push-notifications-fcm',
          message_id: messageId,
        },
        android: {
          collapseKey: 'generic-new-messages',
          priority: 'high',
          notification: silent
            ? undefined
            : {
                tag: 'generic-new-messages',
                icon: 'ic_notification',
              },
        },
        apns: {
          headers: silent
            ? {
                'apns-collapse-id': 'generic-new-messages',
                'apns-push-type': 'background',
                'apns-priority': '5',
              }
            : {
                'apns-collapse-id': 'generic-new-messages',
                'apns-push-type': 'alert',
                'apns-priority': '10',
              },
          payload: {
            aps: silent ? { contentAvailable: true } : { sound: 'default' },
          },
        },
        notification: silent
          ? undefined
          : {
              title: 'Hologram',
              body: 'You have new messages',
            },
      }

      const response = await getMessaging(this.fcmApp).send(message)
      this.logger?.debug(`Message sent successfully: ${response}`)
      return true
    } catch (error) {
      this.logger?.error('Error while sending notification:', error.message)
      return false
    }
  }

  /**
   * Indicates whether the Firebase Admin SDK has been successfully initialized.
   * @returns True if initialized, false otherwise
   */
  public isInitialized(): boolean {
    return this.fcmApp !== null
  }
}
