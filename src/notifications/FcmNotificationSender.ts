export interface FcmNotificationSender {
  sendMessage(registrationToken: string, messageId: string): Promise<boolean> | boolean
  isInitialized(): boolean
}
