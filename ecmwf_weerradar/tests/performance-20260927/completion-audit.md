# Performance audit, 27 September 2026

Production deployment of 4743d976 completed successfully (GitHub Pages run
36331095190). Local diagnostic-only commit 483855e0 is not yet published.

Verified improvements:
- Significant-weather tile benchmark: approximately 171 to 107 ms per 50
  tiles, with identical classification and no reduction in grid resolution.
- Significant-weather field generation: identical values with cooperative
  slices, measured longest slice approximately 7 ms instead of 614 ms for
  one synchronous full computation. Total async computation is slightly longer.
- First view reveals already painted tiles without waiting for the entire
  layer. In one browser observation first paint preceded full readiness by
  3572 ms. Later forecast times still switch atomically.
- Small pans reuse source fields; only one overlay repaint is now performed
  when the same field objects cover the new viewport. Verified in Chrome.
- Existing compositor movement tests exercise 120 updates without repainting
  the weather overlay during the gesture.

Not established:
- Foreground gesture FPS: even after foreground confirmation the automated
  gesture produced only eight RAF callbacks over approximately six seconds.
  This is not suitable proof of normal user interaction smoothness.
- A controlled cold end-to-end comparison across ECMWF, GFS and regional
  HARMONIE, including field download, decode, worker paint and final display.

The goal remains open. Component benchmarks and earlier availability do not
by themselves establish the full end-to-end requirement.
