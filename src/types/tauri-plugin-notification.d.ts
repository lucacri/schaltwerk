declare module '@tauri-apps/plugin-notification' {
  type PermissionStatus = 'granted' | 'denied' | 'restricted' | 'prompt' | string

  /**
   * Check whether notifications are already permitted.
   */
  export function isPermissionGranted(): Promise<boolean>

  /**
   * Ask the user for notification permission.
   */
  export function requestPermission(): Promise<PermissionStatus>

  export function sendNotification(options: { title: string; body?: string } | string): void

  const _default: {
    isPermissionGranted: typeof isPermissionGranted
    requestPermission: typeof requestPermission
    sendNotification: typeof sendNotification
  }

  export default _default
}
