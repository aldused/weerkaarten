"""Local static preview. The published application needs no Python server.

Responses mirror the production CDN closely enough for measurements: text is
gzipped, versioned files under assets/ may be cached for a day, HTML always
revalidates, and an unchanged file answers 304. Without this, a local timing
would be distorted by uncompressed JavaScript and GeoJSON.
"""
import argparse
import gzip
import io
import os
from email.utils import formatdate, parsedate_to_datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

COMPRESSIBLE = ('text/', 'application/javascript', 'application/json', 'image/svg+xml', 'application/geo+json')
MIN_COMPRESS_BYTES = 512


class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            stat = os.stat(path)
            with open(path, 'rb') as handle:
                body = handle.read()
        except OSError:
            self.send_error(404, 'File not found')
            return None
        modified = formatdate(stat.st_mtime, usegmt=True)
        content_type = self.guess_type(path)
        cache = 'no-cache' if content_type.startswith('text/html') else 'public, max-age=86400'
        since = self.headers.get('If-Modified-Since')
        if since:
            try:
                unchanged = parsedate_to_datetime(since).timestamp() >= int(stat.st_mtime)
            except (TypeError, ValueError):
                unchanged = False
            if unchanged:
                self.send_response(304)
                self.send_header('Last-Modified', modified)
                self.send_header('Cache-Control', cache)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return None
        encoding = None
        if (len(body) >= MIN_COMPRESS_BYTES and 'gzip' in self.headers.get('Accept-Encoding', '')
                and any(content_type.startswith(kind) for kind in COMPRESSIBLE)):
            body = gzip.compress(body, 6)
            encoding = 'gzip'
        self.send_response(200)
        self.send_header('Content-type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Last-Modified', modified)
        self.send_header('Cache-Control', cache)
        if encoding:
            self.send_header('Content-Encoding', encoding)
        self.end_headers()
        return io.BytesIO(body)


parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8788)
parser.add_argument('--directory', default=str(Path(__file__).resolve().parent))
args = parser.parse_args()
handler = partial(Handler, directory=args.directory)
print(f'Weerradar: http://127.0.0.1:{args.port}/', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), handler).serve_forever()
