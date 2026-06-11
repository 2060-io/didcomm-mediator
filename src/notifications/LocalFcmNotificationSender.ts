import type { App as FcmApp } from 'firebase-admin/app'
import type { AndroidConfig, ApnsConfig, Message } from 'firebase-admin/messaging'
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

  public async sendMessage(registrationToken: string, messageId: string, devicePlatform?: string | null) {
    try {
      if (!this.fcmApp) {
        this.logger?.warn('Firebase Admin is not initialized. Skipping notification.')
        return false
      }
      const data = {
        '@type': 'https://didcomm.org/push-notifications-fcm',
        message_id: messageId,
      }
      const android: AndroidConfig = {
        collapseKey: 'generic-new-messages',
        priority: 'high',
      }
      const notification = {
        title: 'Hologram',
        body: 'Checking for new messages',
      }
      // No aps sound key: silent delivery (no tone or vibration) on iOS
      const apns: ApnsConfig = {
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-collapse-id': 'generic-new-messages',
        },
        payload: { aps: { contentAvailable: true, threadId: 'generic-new-messages' } },
      }
      let message: Message
      if (devicePlatform === 'android') {
        message = { token: registrationToken, data, android }
      } else if (devicePlatform === 'ios') {
        message = { token: registrationToken, notification, data, apns }
      } else {
        message = {
          token: registrationToken,
          notification,
          data,
          android: { ...android, notification: { tag: 'generic-new-messages', icon: 'ic_notification' } },
          apns,
        }
      }
      const response = await firebaseAdmin.messaging(this.fcmApp).send(message)
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
