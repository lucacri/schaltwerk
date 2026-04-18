import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sendAttentionSystemNotification,
} from './attentionBridge'
import { logger } from './logger'

const notificationMocks = vi.hoisted(() => ({
  isMacOS: vi.fn<() => Promise<boolean>>(),
  isPermissionGranted: vi.fn<() => Promise<boolean>>(),
  requestPermission: vi.fn<() => Promise<string>>(),
  sendNotification: vi.fn<(options: { title: string; body: string }) => void>(),
}))

vi.mock('@tauri-apps/plugin-notification', () => notificationMocks)

vi.mock('./platform', () => ({
  isMacOS: notificationMocks.isMacOS,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(),
  UserAttentionType: {
    Informational: 'informational',
  },
}))

describe('sendAttentionSystemNotification', () => {
  beforeEach(() => {
    notificationMocks.isPermissionGranted.mockReset()
    notificationMocks.isMacOS.mockReset()
    notificationMocks.isMacOS.mockResolvedValue(true)
    notificationMocks.requestPermission.mockReset()
    notificationMocks.sendNotification.mockReset()
  })

  it('skips system notifications outside macOS', async () => {
    notificationMocks.isMacOS.mockResolvedValue(false)

    await sendAttentionSystemNotification('Linux session')

    expect(notificationMocks.isPermissionGranted).not.toHaveBeenCalled()
    expect(notificationMocks.requestPermission).not.toHaveBeenCalled()
    expect(notificationMocks.sendNotification).not.toHaveBeenCalled()
  })

  it('sends immediately when permission is already granted', async () => {
    notificationMocks.isPermissionGranted.mockResolvedValue(true)

    await sendAttentionSystemNotification('Fix notifications')

    expect(notificationMocks.requestPermission).not.toHaveBeenCalled()
    expect(notificationMocks.sendNotification).toHaveBeenCalledWith({
      title: 'Lucode needs attention',
      body: 'Fix notifications is waiting for input.',
    })
  })

  it('requests permission and sends when the prompt is granted', async () => {
    notificationMocks.isPermissionGranted.mockResolvedValue(false)
    notificationMocks.requestPermission.mockResolvedValue('granted')

    await sendAttentionSystemNotification('Review branch')

    expect(notificationMocks.requestPermission).toHaveBeenCalledTimes(1)
    expect(notificationMocks.sendNotification).toHaveBeenCalledWith({
      title: 'Lucode needs attention',
      body: 'Review branch is waiting for input.',
    })
  })

  it('logs and skips the notification when permission is denied', async () => {
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    notificationMocks.isPermissionGranted.mockResolvedValue(false)
    notificationMocks.requestPermission.mockResolvedValue('denied')

    await sendAttentionSystemNotification('Blocked session')

    expect(notificationMocks.sendNotification).not.toHaveBeenCalled()
    expect(debugSpy).toHaveBeenCalledWith(
      '[attentionBridge] Notification permission not granted; skipping system notification',
      { permission: 'denied' }
    )
    debugSpy.mockRestore()
  })
})
