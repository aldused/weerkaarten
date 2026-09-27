# Browser observations, 27 September 2026

Chrome, local production bundle through existing preview proxy, profile=1,
3200 × 1512.5 CSS pixels, ECMWF weather mode with cloud, precipitation,
visibility and snowfall. These are diagnostic observations, not controlled
before/after full-page timing claims.

At commit 8f294bcc:
- Metadata ready: 1194 ms; first visible weather: 6329 ms; full initial frame: 9310 ms.
- 6 rendering workers, no fallback tiles rendered on the main thread.
- A 200 × 60 pixel drag reused the same 10 field reads.
- Viewport sample update after drag: 233 ms.
- Last label/overlay draw: 134 ms. moveend schedules a draw and
  updateViewportSamples unconditionally scheduled another even for identical fields.

Follow-up: only schedule the latter draw if a field object changed. New crops,
newly available fields and model/time changes still redraw normally.

Open verification: controlled full-load comparison, frame timing during gestures,
other model/layer coverage, and production publication verification.

After the duplicate-draw fix, local Chrome reload and 100 × 30 pixel drag:
- Ready before and after; no console errors.
- Overlay draw count rose from 5 to 6: exactly one draw.
- Field reads stayed at 10: no new source downloads for this pan.
- Final overlay draw 63 ms, viewport sample completion 348 ms. Different
  crop/zoom from the earlier observation, so these durations are not an A/B speedup.

Progressive first-view reveal:
- Previously a layer became visible only at its final tile's load event.
- Map adapter now emits a one-time firstTile event. Only the initial frame
  uses that event to reveal a layer; replacements still commit after loading.
- Chrome local preview: first weather visible at 5119 ms; full frame at
  8691 ms. All four final layers had opacity 1 and 72/72 loaded tiles.
- This proves partial availability precedes full readiness by 3572 ms in
  this run; it is not a controlled comparison of network download speed.

Gesture diagnostics (profile=1 only):
- Added local RAF interval recording between map movestart and moveend.
- Automated drag: 6366 ms, 8 frame callbacks, p95/max 1017 ms. Page reported
  visibilityState=visible. This is consistent with occluded-window throttling
  or automation pacing; it does not establish foreground smoothness.
- Foreground confirmation requested before interpreting gesture frame rates.
- Repeat first-visible weather was 1840 ms (warm caches; not a cold-load comparison).
