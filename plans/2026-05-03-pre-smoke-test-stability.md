# Pre-smoke test stability — run-twice discipline

Per CLAUDE.md: "the full suite must produce identical results twice." This file captures the result of running `just test` twice back-to-back on `pre-smoke-walk-3`.

## Method

```bash
just test 2>&1 > /tmp/run1.log
just test 2>&1 > /tmp/run2.log
```

Both runs against branch `task-flow-v2` at HEAD. Cache state was warm from prior validation (W.7 pass). The tsbuildinfo cache had been freshly invalidated and rebuilt earlier in W.7.

## Results

| Run | Exit | Duration | Rust pass | Rust fail | Frontend | MCP | LEAK markers in summary |
|-----|------|----------|-----------|-----------|----------|-----|-------------------------|
| 1   | 0    | 64s      | 2438 / 2438 | 0       | passed   | passed | 0 |
| 2   | 0    | 58s      | 2438 / 2438 | 0       | passed   | passed | 0 |

Run 2 was 6s faster, expected (warmer cargo + tsc + vitest caches).

## Diff

`grep -E "(FAIL|fail|✗|×|leaky|Leaky|LEAK)|tests run:|Summary \[|tests pass" run1.log | sort -u` vs the same for run2 — **identical**:

```
✓ Frontend tests passed
✓ MCP tests passed
✓ Rust tests passed
```

## Slow / leaky inventory (informational)

Run 2's slow-test inventory matches Run 1's, both within nextest's `SLOW > 5s` and `SLOW > 10s` markers. The same ~58 tests cross the 5s threshold each run; the same ~16 tests cross 10s. All are in the terminal manager / tmux integration test families (`domains::terminal::*`), which is expected — they spin real PTYs.

No tests reported as `LEAK` in either summary line. (Earlier W.6 boundary saw `2 leaky` in one run's footer notation, but that's a different category — those are tests that the nextest harness flagged for resource cleanup but didn't fail. Today's runs show 0.)

## Verdict

**Suite is deterministic across two runs.** No flakes, no leaks visible at the suite-summary level, no test count drift. The pre-smoke-walk-3 baseline is reproducible.

## What this does NOT cover

- **Long-tail flakes.** Two runs is a small sample. A flake at ~1% rate has ~98% chance of staying hidden across two runs.
- **Real PTY resource leaks.** Nextest doesn't track FD/process counts beyond the leaky marker. The terminal-test family is heavy; if there's a slow leak that compounds across many runs, two runs won't surface it.
- **Frontend memory growth.** Vitest doesn't profile heap by default. A component test that leaks a setInterval would just slow down subsequent tests, not fail them.
- **Cross-suite races.** Each run is sequential `just test` (Rust → MCP → frontend). A race that needs concurrent execution wouldn't show.

## Recommendations (post-smoke)

- Run `just test` 5–10× in CI on a low-traffic day to surface long-tail flakes.
- If the user adds `--retries N` to nextest config, document the policy. Currently nextest is run with default config (no retries), which is the right default for a deterministic suite.
- The terminal test family's slow tests are pre-existing — Phase 8 didn't make them slower. No action needed here.
