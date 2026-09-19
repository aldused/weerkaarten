#!/bin/bash
#
# PASCAL 2× per dag (zie nl.edaldus.pascal.plist):
#   - 11:30 lokaal (dekt ECMWF 00z run, publiek ~09:30 UTC)
#   - 21:00 lokaal (dekt ECMWF 12z run, publiek ~18:30 UTC)
#
# Stappen:
#   1. Snelle Open-Meteo fallback ophalen, bouwen en direct publiceren.
#   2. Native ECMWF/HarmonEPS/ICON-D2 begrensd en parallel verversen.
#   3. Met alle verse bronnen opnieuw bouwen en publiceren.
#
# Tijdelijke GRIB-files: /tmp/pascal_grib_<random>/ (auto-gewist op script-einde)

set -euo pipefail
cd /Users/aldus/KNMI_Project/pascal

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
LOG_DIR="/Users/aldus/KNMI_Project/pascal/logs"
mkdir -p "$LOG_DIR"
STAMP=$(date '+%Y-%m-%d_%H%M')
LOG="$LOG_DIR/pascal_${STAMP}.log"

echo "=== PASCAL run gestart $(date) ===" >> "$LOG"

PUBLISH_DIR=""
cleanup_publish_worktree() {
    if [ -n "${PUBLISH_DIR:-}" ] && [ -d "$PUBLISH_DIR" ]; then
        git -C "/Users/aldus/KNMI_Project/weerlab" worktree remove --force "$PUBLISH_DIR" >> "$LOG" 2>&1 || true
    fi
}
trap cleanup_publish_worktree EXIT

run_fetch_grib() {
    set +e
    run_limited 5400 /usr/local/bin/python3 fetch_grib.py 2>&1 | grep -vE "\.grib2:|By downloading|To ensure" >> "$LOG"
    local status=${PIPESTATUS[0]}
    set -e
    return "$status"
}

run_limited() {
    local seconds="$1"
    shift
    /usr/local/bin/python3 -c 'import subprocess,sys
try:
    raise SystemExit(subprocess.run(sys.argv[2:], timeout=float(sys.argv[1])).returncode)
except subprocess.TimeoutExpired:
    print(f"[timeout] na {sys.argv[1]} seconden: {sys.argv[2:]}", file=sys.stderr)
    raise SystemExit(124)' "$seconds" "$@"
}

publish_pascal() {
    local reason="$1"
    cd "/Users/aldus/KNMI_Project/weerlab"
    if git diff --quiet -- pascal.html pascal-data.json _deploy/pascal.html _deploy/pascal-data.json pluim_harmoneps/; then
        echo "[ok] geen publish-wijzigingen ($reason)" >> "$LOG"
        cd "/Users/aldus/KNMI_Project/pascal"
        return
    fi
    run_limited 180 git fetch origin main >> "$LOG" 2>&1
    PUBLISH_DIR="/tmp/pascal_publish_${STAMP}_$$_${reason}"
    git worktree add --detach "$PUBLISH_DIR" origin/main >> "$LOG" 2>&1
    cp pascal.html "$PUBLISH_DIR/pascal.html"
    cp pascal-data.json "$PUBLISH_DIR/pascal-data.json"
    mkdir -p "$PUBLISH_DIR/_deploy"
    cp _deploy/pascal.html "$PUBLISH_DIR/_deploy/pascal.html"
    cp _deploy/pascal-data.json "$PUBLISH_DIR/_deploy/pascal-data.json"
    rsync -a --delete pluim_harmoneps/ "$PUBLISH_DIR/pluim_harmoneps/" >> "$LOG" 2>&1
    if ! git -C "$PUBLISH_DIR" diff --quiet -- pascal.html pascal-data.json _deploy/pascal.html _deploy/pascal-data.json pluim_harmoneps/; then
        git -C "$PUBLISH_DIR" add pascal.html pascal-data.json _deploy/pascal.html _deploy/pascal-data.json pluim_harmoneps/
        git -C "$PUBLISH_DIR" commit -m "PASCAL update ${reason} $(date '+%Y-%m-%d %H:%M')" >> "$LOG" 2>&1
        run_limited 180 git -C "$PUBLISH_DIR" push origin HEAD:main >> "$LOG" 2>&1
        echo "[ok] PASCAL gepusht ($reason)" >> "$LOG"
    fi
    git -C "/Users/aldus/KNMI_Project/weerlab" worktree remove --force "$PUBLISH_DIR" >> "$LOG" 2>&1 || true
    PUBLISH_DIR=""
    cd "/Users/aldus/KNMI_Project/pascal"
}

# 1. Snelle fallback met expliciete parameter-/leden-/gebiedsdekking.
# Een totale ophaalfout behoudt de vorige bron; native verwerking blijft lopen.
run_limited 900 /usr/local/bin/python3 fetch_om.py >> "$LOG" 2>&1 || {
    echo "[warn] verse Open-Meteo fallback ontbreekt; native bronnen blijven proberen" >> "$LOG"
    true
}
# Bouw MOS-modellen (lookup v2 als fallback + logreg v3 primair) als ouder dan 7 dagen
if [ -z "$(find fog_mos_logreg.json -mtime -7 2>/dev/null)" ]; then
    /usr/local/bin/python3 build_fog_mos_v3.py >> "$LOG" 2>&1 || echo "[warn] MOS v3 rebuild faalde" >> "$LOG"
fi
if [ -z "$(find fog_climatology.json -mtime -7 2>/dev/null)" ]; then
    /usr/local/bin/python3 build_fog_mos_v2.py >> "$LOG" 2>&1 || echo "[warn] MOS v2 rebuild faalde" >> "$LOG"
fi
run_limited 300 /usr/local/bin/python3 process_om.py >> "$LOG" 2>&1 || {
    echo "[err] process_om.py faalde; niet publiceren" >> "$LOG"
    true
}
if run_limited 300 /usr/local/bin/python3 build_hybrid.py >> "$LOG" 2>&1; then
    publish_pascal "fallback"
else
    echo "[warn] geen geldige fallback; native bronnen verversen" >> "$LOG"
fi

# 2. Native bronnen parallel, elk met een harde bovengrens. De snelle fallback
# staat dan al live. build_hybrid.py weigert bronnen ouder dan 20 uur.
run_fetch_grib & grib_pid=$!
run_limited 3600 /usr/local/bin/python3 fetch_harmoneps.py >> "$LOG" 2>&1 & harm_pid=$!
run_limited 1800 /usr/local/bin/python3 fetch_dwd_icond2eps.py >> "$LOG" 2>&1 & dwd_pid=$!
set +e
wait "$grib_pid"; grib_status=$?
wait "$harm_pid"; harm_status=$?
wait "$dwd_pid"; dwd_status=$?
set -e
[ "$grib_status" -eq 0 ] || echo "[warn] ECMWF native faalde/timeout; fallback blijft actief" >> "$LOG"
[ "$harm_status" -eq 0 ] || echo "[warn] HarmonEPS faalde/timeout; bron wordt overgeslagen" >> "$LOG"
[ "$dwd_status" -eq 0 ] || echo "[warn] DWD ICON-D2 faalde/timeout; bron wordt overgeslagen" >> "$LOG"

if [ "$grib_status" -eq 0 ] || [ "$harm_status" -eq 0 ] || [ "$dwd_status" -eq 0 ]; then
    run_limited 300 /usr/local/bin/python3 build_hybrid.py >> "$LOG" 2>&1
    publish_pascal "native"
fi

# Ook de JSON + lokale demo commiten naar KNMI_Project (archief, alleen als git repo)
cd /Users/aldus/KNMI_Project
if git rev-parse --git-dir >/dev/null 2>&1; then
    archive_paths=(pascal/pascal_real.json demo_pascal_live.html)
    if [ "$grib_status" -eq 0 ]; then archive_paths+=(pascal/pascal_real_grib.json); fi
    if [ "$harm_status" -eq 0 ]; then archive_paths+=(pascal/pascal_real_harmoneps.json); fi
    if [ "$dwd_status" -eq 0 ]; then archive_paths+=(pascal/pascal_real_icond2eps.json); fi
    if ! git diff --quiet -- "${archive_paths[@]}" 2>/dev/null; then
        git add "${archive_paths[@]}" 2>/dev/null || true
        git commit --only -m "PASCAL data update $(date '+%Y-%m-%d %H:%M')" -- "${archive_paths[@]}" >> "$LOG" 2>&1 || true
        git push >> "$LOG" 2>&1 || true
    fi
fi

# Oude logs opschonen (>14 dagen)
find "$LOG_DIR" -name "pascal_*.log" -mtime +14 -delete

echo "=== Klaar $(date) ===" >> "$LOG"
