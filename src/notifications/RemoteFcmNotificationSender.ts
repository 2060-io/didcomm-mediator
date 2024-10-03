import axios from 'axios'
import { Logger } from '@credo-ts/core'
import { FCM_SERVICE_BASE_URL } from '../config/constants'
import { FcmNotificationSender } from './FcmNotificationSender'

export class RemoteFcmNotificationSender implements FcmNotificationSender {
  private logger: Logger

  public constructor(logger: Logger) {
    this.logger = logger
  }

  public async sendMessage(registrationToken: string, messageId: string) {
    try {
      this.logger?.debug(`[sendFmcNotification] Initialize send notification`)

      const fcmResponse = await axios.post(FCM_SERVICE_BASE_URL, {
        token: registrationToken,
        messageId,
      })
      this.logger?.debug(`[sendFmcNotification] FCM response sucess:${fcmResponse.data.response.success}`)
      if (fcmResponse.data.response.success) {
        this.logger?.debug(
          `[sendFcmNotification] Success sending FCM notification: ${JSON.stringify(fcmResponse.data)}`
        )
      } else {
        this.logger?.error(
          `[sendFcmNotification] FCM notification was not successful: ${JSON.stringify(fcmResponse.data)}`
        )
      }
      return fcmResponse.data.response.success as boolean
    } catch (error) {
      this.logger?.error(`[sendFcmNotification] Error sending FCM notification: ${error.message}`)
      return false
    }
  }
}
