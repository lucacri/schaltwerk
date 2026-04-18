export async function isPermissionGranted(): Promise<boolean> {
  return true
}

export async function requestPermission(): Promise<'granted'> {
  return 'granted'
}

export function sendNotification(_options: { title: string; body?: string } | string): void {
  void _options
}

export default {
  isPermissionGranted,
  requestPermission,
  sendNotification,
}
