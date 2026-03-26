import { describe, it, expect } from 'vitest'
import { computeRenderOrder } from './virtualization'

describe('computeRenderOrder', () => {
  it('returns empty array when limit is zero', () => {
    expect(computeRenderOrder(['a'], ['b'], 0)).toEqual([])
  })

  it('returns empty array when limit is negative', () => {
    expect(computeRenderOrder(['a'], ['b'], -1)).toEqual([])
  })

  it('prioritizes visible items over previous items', () => {
    const result = computeRenderOrder(['prev1', 'prev2'], ['vis1', 'vis2'], 2)
    expect(result).toEqual(['vis1', 'vis2'])
  })

  it('fills remaining slots with previous items after visible items', () => {
    const result = computeRenderOrder(['prev1', 'prev2'], ['vis1'], 3)
    expect(result).toEqual(['vis1', 'prev1', 'prev2'])
  })

  it('deduplicates items appearing in both arrays', () => {
    const result = computeRenderOrder(['a', 'b', 'c'], ['b', 'c'], 5)
    expect(result).toEqual(['b', 'c', 'a'])
  })

  it('deduplicates within the visible array itself', () => {
    const result = computeRenderOrder([], ['a', 'a', 'b'], 5)
    expect(result).toEqual(['a', 'b'])
  })

  it('respects limit when visible items exceed it', () => {
    const result = computeRenderOrder([], ['a', 'b', 'c', 'd'], 2)
    expect(result).toEqual(['a', 'b'])
  })

  it('respects limit when combined items exceed it', () => {
    const result = computeRenderOrder(['p1', 'p2'], ['v1'], 2)
    expect(result).toEqual(['v1', 'p1'])
  })

  it('handles empty visible and previous arrays', () => {
    expect(computeRenderOrder([], [], 5)).toEqual([])
  })

  it('handles empty visible array with previous items', () => {
    const result = computeRenderOrder(['a', 'b'], [], 3)
    expect(result).toEqual(['a', 'b'])
  })

  it('handles empty previous array with visible items', () => {
    const result = computeRenderOrder([], ['x', 'y'], 3)
    expect(result).toEqual(['x', 'y'])
  })

  it('does not include previous duplicates', () => {
    const result = computeRenderOrder(['a', 'a', 'b'], [], 5)
    expect(result).toEqual(['a', 'b'])
  })
})
