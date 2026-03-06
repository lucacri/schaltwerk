import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SwitchProfiler, isSwitchProfilingEnabled } from './switchProfiler';

describe('SwitchProfiler', () => {
  let originalLocalStorage: Storage;

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  test('isSwitchProfilingEnabled returns false when TERMINAL_DEBUG is not set', () => {
    const mockStorage = { getItem: vi.fn().mockReturnValue(null) } as unknown as Storage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
    expect(isSwitchProfilingEnabled()).toBe(false);
  });

  test('isSwitchProfilingEnabled returns true when TERMINAL_DEBUG is "1"', () => {
    const mockStorage = { getItem: vi.fn().mockReturnValue('1') } as unknown as Storage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
    expect(isSwitchProfilingEnabled()).toBe(true);
  });

  test('phase records elapsed time', () => {
    const profiler = new SwitchProfiler('test-terminal');
    profiler.begin('acquire');
    profiler.end('acquire');
    const timings = profiler.getTimings();
    expect(timings).toHaveProperty('acquire');
    expect(typeof timings.acquire).toBe('number');
    expect(timings.acquire).toBeGreaterThanOrEqual(0);
  });

  test('multiple phases are tracked independently', () => {
    const profiler = new SwitchProfiler('test-terminal');
    profiler.begin('acquire');
    profiler.end('acquire');
    profiler.begin('attach');
    profiler.end('attach');
    const timings = profiler.getTimings();
    expect(Object.keys(timings)).toContain('acquire');
    expect(Object.keys(timings)).toContain('attach');
  });

  test('totalMs returns sum of all phases', () => {
    const profiler = new SwitchProfiler('test-terminal');
    profiler.begin('a');
    profiler.end('a');
    profiler.begin('b');
    profiler.end('b');
    const total = profiler.totalMs();
    const timings = profiler.getTimings();
    const sum = Object.values(timings).reduce((acc, v) => acc + v, 0);
    expect(total).toBeCloseTo(sum, 1);
  });

  test('summary returns formatted string', () => {
    const profiler = new SwitchProfiler('my-terminal');
    profiler.begin('acquire');
    profiler.end('acquire');
    const summary = profiler.summary();
    expect(summary).toContain('[SwitchProfile my-terminal]');
    expect(summary).toContain('acquire=');
    expect(summary).toContain('ms');
    expect(summary).toContain('total=');
  });

  test('end without begin is ignored', () => {
    const profiler = new SwitchProfiler('test');
    profiler.end('nonexistent');
    expect(profiler.getTimings()).toEqual({});
  });

  test('double begin overwrites start time', () => {
    const profiler = new SwitchProfiler('test');
    profiler.begin('phase');
    profiler.begin('phase');
    profiler.end('phase');
    const timings = profiler.getTimings();
    expect(timings).toHaveProperty('phase');
  });
});
