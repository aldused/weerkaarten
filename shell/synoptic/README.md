# Weerbeeld Europa (BETA)

UI: `beta-synoptisch/index.html`; existing BETA tab: `beta.html#synoptisch`.
The UI reads the complete R2 manifest, with a bundled, dated fallback.

Run `python3 shell/synoptic/refresh.py --publish` from the existing Weerlab environment.
Requires its installed NumPy/SciPy/Matplotlib/Pillow/pyproj, Node/Open-Meteo dependencies,
and existing rclone `r2:weerlab-data` configuration. No credentials are stored here.

The launchd job checks at 10:00 and 22:00 local time, and once at load. The Mac must
be running and logged in; these are checks, not a guarantee of a new chart cycle.

## Scientific publication gate

- Discover five actual 12 UTC validity times in the official Met Office page.
- Require a completed UKMO model run from exactly the same cycle.
- Use native accumulation intervals (1/3/6 hours), converted to mm/hour.
- Require reviewed `fronts/YYYYMMDDTHH.json` for all five dates. Coordinates are
  source pixels normalized to the 960×647 Bracknell projection. Include every
  trough, and record front type and symbol side. Existing format is documented
  by `trace_fronts.py`.
- New source charts are downloaded to `.synoptic-cache/review/<cycle>/`.
- Missing review blocks replacement of the complete reviewed set. An update may never silently remove fronts. **Front extraction is not automated.**
  Raster thickness cannot reliably distinguish all troughs from isobars/text.
- There is no trustworthy separate UKMO snow field in the present data. No
  subtraction of unrelated precipitation fields or temperature-only snow guess.
  Until supported, display total precipitation and disable the snow toggle.
- Pressure centers need a complete surrounding ring, minimum prominence 0.35 hPa and
  median prominence 1 hPa, tested at several spatial scales.
  Centers near the map edge may consequently be omitted.
- Upload a complete immutable asset directory, verify uploaded sizes, then replace
  `synoptic/current.json`. Failure preserves the last complete published set.

Check `.synoptic-cache/status.json` and the launchd log when no new set appears.
This first BETA has deliberate limits: new map sets with fronts require manual review and snowfall
cannot yet be displayed separately. Do not describe the entire chain as automatic.

## Optional meteorological layers

- Six city anchors use native UKMO temperature at 12 UTC (14:00 CEST / 13:00 CET).
  Dates are formatted with Europe/Amsterdam, including dates spanning the DST change.
- Separate maxima use current DWD MOSMIX TX from the existing Weerlab feeds.
  These are daytime maxima, not instantaneous 12 UTC values. Nearby station identity,
  date, run and update stamp are retained in the manifest. Feeds over 36 hours old,
  missing dates and nonfinite values produce no invented labels.
- Cloud selection uses cloud_cover, cloud_cover_low, cloud_cover_mid and cloud_cover_high
  from the same native UKMO run/time; only supplied levels are enabled.
- Wind uses mean 10 m speed in m/s, standard Beaufort boundaries, and arrows pointing
  along the flow (meteorological FROM bearing + 180 degrees); gusts are never substituted.
- Tests: python3 -m unittest discover -s shell/synoptic -p 'test_*.py'.
