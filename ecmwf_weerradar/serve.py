"""Local static preview. The published application needs no Python server."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8788)
args = parser.parse_args()
handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parent))
print(f'Weerradar: http://127.0.0.1:{args.port}/', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), handler).serve_forever()
