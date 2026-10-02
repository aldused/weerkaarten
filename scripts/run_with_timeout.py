"""Bound a scheduled subprocess and its children without touching its data."""
import argparse
import os
import signal
import subprocess
import sys

def run(command, seconds, grace=15):
    process = subprocess.Popen(command, start_new_session=True)
    try:
        return process.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        print(f'FOUT: import timeout after {seconds}s: {command[0]}', file=sys.stderr, flush=True)
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        return 124

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--seconds',type=float,required=True)
    parser.add_argument('command',nargs=argparse.REMAINDER)
    args=parser.parse_args()
    if args.seconds<=0 or not args.command:parser.error('positive timeout and command required')
    return run(args.command,args.seconds)

if __name__=='__main__':raise SystemExit(main())
