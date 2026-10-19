#!/bin/bash
set -euo pipefail
ROOT=/Users/aldus/KNMI_Project/weerlab
STATE="/Users/aldus/Library/Application Support/Weerlab/wind-six"
mkdir -p "$STATE"
# flock lives in Python because macOS does not ship the flock command.
/usr/local/bin/python3 -u -c 'import fcntl,os,runpy,sys
state=sys.argv[1];root=sys.argv[2]
lock=open(os.path.join(state,"build.lock"),"w")
try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:raise SystemExit(0)
sys.argv=["build.py","--out",os.path.join(state,"published"),"--cache",os.path.join(state,"cache"),"--publish"]
runpy.run_path(os.path.join(root,"shell/wind_six/build.py"),run_name="__main__")' "$STATE" "$ROOT"
