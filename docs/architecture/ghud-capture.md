# GHUD 采集与资源累计数

GHUD measures capture, transport, OCR and match confirmation separately. The browser sends calibrated PNG crops as JSON. A remote server can advertise gzip support after the first successful sample, allowing the browser to compress subsequent large requests losslessly. Loopback continues to use JSON. Compare the [occlusion replay](../guides/hud-occlusion-replay.md) with the [transport and WebSocket acknowledgement benchmarks](../validation/upload-latency.md).

```text
Windows/shared screenshot ─┐
Local Control → verified LDPlayer → bounded screencap ─┤
                     ↓ normalized canvas
       seven digits + opt-in objective digit crops
                     ↓ existing numeric worker
       independent HUD / objective verification
                     ↓ one revision / ACK / Undo
              Store → Caster / GameHud
```

`server/adbCapture.ts` owns verified instance discovery, a single allowed capture command, 8-second subprocess bounds, PNG/pixel validation and single-flight rejection. HTTP routes reuse the local Control guard; request closure and timeout abort the child. Browser input contains only a discovered instance index, never a command/path/serial/address.

`useAdbHudCapture` is GHUD-local. Hidden Windows capture remains mounted to preserve shared services. Source generation, resolution and content crop invalidate pending work. `hudCalibrationProfiles` stores bounded browser profiles; every source switch requires approval. Failed samples discard candidates, preserving trusted Store values.

Resource OCR has separate rules/parser and bypasses the HUD candidate cache. Decoded counter and clock crop pixels form a SHA-256 fingerprint; OCR text jitter cannot make identical pixels independent. Advancing clock, two matching absolute values, ≥85% confidence and monotonic/rate checks guard repeated or implausible evidence. No banner counting, guessed event increments or automatic presence updates are implemented.

Optional `NeutralObjective.countSources/countFrozen/countEpoch` preserve legacy archives. Missing freeze metadata means frozen until resumed. The server derives manual metadata and ignores client-supplied metadata on general stats edits. Value/type edits advance the per-counter barrier; a runtime restart/Undo barrier rejects older evidence without rewriting historical snapshots.

`live_objective_count/freeze` require current game context. `live_objective_ocr` supports resource-only evidence; the normal capture loop includes optional resource samples inside existing `live_game_ocr` so one frame shares a single revision/ACK/Undo entry. Current committed draft records receive a deep `liveGameStats` snapshot after HUD actions. Next game resets live counters without altering old records. Legacy records without the optional snapshot remain valid.

Only preview/calibration state lives outside Store. Formal counts, provenance, locks, history and persistence remain authoritative. No new match store or production reset is introduced.
