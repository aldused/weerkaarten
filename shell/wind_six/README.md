# ECMWF wind comparison

Six panels share one validity and one run: operational/control wind and three-hour gust;
51-member scalar mean of each field; 51-member pointwise maximum of each field.
Calculate wind statistics in m/s before Beaufort conversion. Include members 0–50;
missing members/values/units/time steps block publication. Native Europe uses hourly
gust windows through +90 (aggregate each member over three hours), then native 3h gusts.

`build.py` uses the central `scripts/open_meteo.py` customer helper. Credentials remain
outside the repository/browser. Native O1280 Europe provides 00/06 UTC (about 9 km).
The global rolling 0.25° ensemble can capture each future 12/18 UTC run when current;
validate source metadata before and after collection, retain completed cycles, and
never relabel the latest forecast as a different cycle. Native data is pinned by run.
Retain actual native coordinates and collapse duplicate nearest cells. Cache source
batches privately; publish only six compact statistics. The frontend displays cells
without manufacturing additional spatial resolution.

The global point API does not archive exact old 12/18 UTC cycles. `backfill.py` seeds
these from the official ECMWF GRIB2 Open Data: all 50 perturbed members plus oper/fc
control, validated date/cycle/end step and three-hour gust start step. The initial
12/18 October 18 comparisons cover October 23 at 21 UTC (the supplied example),
not a fabricated complete timeline. Their availability is disclosed in the UI.
Subsequent captured cycles have a complete 48-step timeline through +144 hours.

Upload an immutable JSON first and its manifest last. `publish_entry` locks and merges
concurrent producers; older cycles or shorter timelines cannot overwrite newer/full
runs. `wind_six_update.sh` uses a private process lock and runs every 20 minutes via
`nl.weerlab.wind-six.plist`. No API key is written in a URL log or public artifact.
