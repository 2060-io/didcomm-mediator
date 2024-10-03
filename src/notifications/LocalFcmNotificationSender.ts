import { initializeApp, App as FcmApp } from 'firebase-admin/app'
import { credential } from 'firebase-admin'
import { getMessaging } from 'firebase-admin/messaging'
import path from 'path'
import { Logger } from '@credo-ts/core'
import { FcmNotificationSender } from './FcmNotificationSender'

export class LocalFcmNotificationSender implements FcmNotificationSender {
  private fcmApp: FcmApp
  private logger: Logger

  public constructor(logger: Logger) {
    this.fcmApp = initializeApp({
      credential: credential.cert(path.resolve(__dirname, '../../firebase-cfg.json')),
    })
    this.logger = logger
  }

  public async sendMessage(registrationToken: string, messageId: string) {
    try {
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
        apns: { payload: { aps: { contentAvailable: true } } },
      })
      this.logger.debug(`Message sent successfully: ${response}`)
      return true
    } catch (error) {
      this.logger.error('Error while sending notification:', error.message)
      return false
    }
  }
}
