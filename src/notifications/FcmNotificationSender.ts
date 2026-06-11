export interface FcmNotificationSender {
  sendMessage(registrationToken: string, messageId: string, devicePlatform?: string | null): Promise<boolean> | boolean
  isInitialized(): boolean
}
