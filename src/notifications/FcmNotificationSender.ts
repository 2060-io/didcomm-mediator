export interface FcmNotificationSender {
  sendMessage(registrationToken: string, messageId: string, silent?: boolean): Promise<boolean> | boolean
  isInitialized(): boolean
}
