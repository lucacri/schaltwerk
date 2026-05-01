import { UnlistenFn } from '@tauri-apps/api/event'
import { logger } from '../../../utils/logger'

export function createSafeUnlistener(fn: UnlistenFn): UnlistenFn {
    let called = false
    return () => {
        if (called) return
        called = true
        try {
            void Promise.resolve(fn()).catch(error => {
                logger.warn('Failed to unlisten sidebar event', error)
            })
        } catch (error) {
            logger.warn('Failed to unlisten sidebar event', error)
        }
    }
}
