/** Injectable clock so every code path is deterministic under test. */

export interface Clock {
  nowMs(): number;
}

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}

/** Manual clock advanced explicitly by tests and the deterministic demo. */
export class ManualClock implements Clock {
  private current: number;

  constructor(startMs: number) {
    this.current = startMs;
  }

  nowMs(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) throw new RangeError("advance() requires a non-negative offset");
    this.current += ms;
  }

  set(ms: number): void {
    this.current = ms;
  }
}
