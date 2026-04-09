import { useMemo } from 'react'
import { atom, useAtomValue } from 'jotai'
import { sessionActivityMapAtom, type SessionActivityData } from '../atoms/sessions'

export function useSessionActivity(sessionId: string): SessionActivityData | undefined {
    const selector = useMemo(
        () => atom((get) => get(sessionActivityMapAtom).get(sessionId)),
        [sessionId],
    )
    return useAtomValue(selector)
}
