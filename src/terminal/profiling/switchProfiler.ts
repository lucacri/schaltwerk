export function isSwitchProfilingEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('TERMINAL_DEBUG') === '1';
  } catch {
    return false;
  }
}

export class SwitchProfiler {
  private readonly terminalId: string;
  private readonly starts = new Map<string, number>();
  private readonly timings = new Map<string, number>();

  constructor(terminalId: string) {
    this.terminalId = terminalId;
  }

  begin(phase: string): void {
    this.starts.set(phase, performance.now());
  }

  end(phase: string): void {
    const start = this.starts.get(phase);
    if (start === undefined) return;
    this.timings.set(phase, performance.now() - start);
    this.starts.delete(phase);
  }

  getTimings(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [k, v] of this.timings) {
      result[k] = v;
    }
    return result;
  }

  totalMs(): number {
    let sum = 0;
    for (const v of this.timings.values()) {
      sum += v;
    }
    return sum;
  }

  summary(): string {
    const phases = Array.from(this.timings.entries())
      .map(([k, v]) => `${k}=${v.toFixed(1)}ms`)
      .join(', ');
    return `[SwitchProfile ${this.terminalId}] ${phases}, total=${this.totalMs().toFixed(1)}ms`;
  }
}
