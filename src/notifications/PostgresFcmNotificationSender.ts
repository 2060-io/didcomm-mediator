import axios from 'axios'
import { FcmNotificationSender } from './FcmNotificationSender'
import { Logger } from '@credo-ts/core'
import { FCM_SERVICE_BASE_URL } from '../config/constants'

export class PostgresFcmNotificationSender implements FcmNotificationSender {
  private logger: Logger

  public constructor(logger: Logger) {
    if (!logger) {
      throw new Error('[PostgresFcmNotificationSender] Logger instance is required')
    }
    this.logger = logger
  }

  /**
   * Sends an FCM notification to the specified registration token with the provided message ID.
   *
   * @param {string} registrationToken - The recipient's FCM registration token.
   * @param {string} messageId - The ID of the message to send.
   * @returns {Promise<boolean>} - Resolves to `true` if the notification was sent successfully, otherwise `false`.
   * @throws {Error} Throws an error if FCM_SERVICE_BASE_URL is not defined or if inputs are invalid.
   */
  public async sendMessage(registrationToken: string, messageId: string): Promise<boolean> {
    try {
      // Validate inputs
      if (!registrationToken || typeof registrationToken !== 'string') {
        throw new Error('[sendMessage] Invalid or missing registrationToken')
      }

      if (!messageId || typeof messageId !== 'string') {
        throw new Error('[sendMessage] Invalid or missing messageId')
      }

      if (!FCM_SERVICE_BASE_URL || typeof FCM_SERVICE_BASE_URL !== 'string') {
        throw new Error('[sendMessage] FCM_SERVICE_BASE_URL is not defined or invalid')
      }

      this.logger?.debug(
        `[sendMessage] Initialize send notification to ${registrationToken} with messageId ${messageId}`
      )

      // Make the request to the FCM service
      const fcmResponse = await axios.post(FCM_SERVICE_BASE_URL, {
        registrationToken,
        messageId,
      })

      const success = fcmResponse?.data?.response?.success

      if (success) {
        this.logger?.debug(`[sendMessage] Success sending FCM notification: ${JSON.stringify(fcmResponse.data)}`)
        return true
      } else {
        this.logger?.error(`[sendMessage] FCM notification was not successful: ${JSON.stringify(fcmResponse.data)}`)
        return false
      }
    } catch (error) {
      this.logger?.error(`[sendMessage] Error sending FCM notification: ${error.message}`, {
        stack: error.stack,
        registrationToken,
        messageId,
      })
      return false
    }
  }
}
