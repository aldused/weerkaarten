"""Bounded streaming multipart reader tolerant of arbitrary TCP chunk boundaries."""
import re
from email.parser import HeaderParser


def stream_parts(self, chunk_size):
    chunks = iter(self.request.iter_content(chunk_size))
    buffer = bytearray()

    def fill(size):
        while len(buffer) < size:
            try:
                buffer.extend(next(chunks))
            except StopIteration as error:
                raise EOFError('Truncated ECMWF multipart response') from error

    def take(size):
        fill(size)
        value = bytes(buffer[:size])
        del buffer[:size]
        return value

    marker = ('--' + self.boundary).encode(self.encoding)
    fill(2)
    if buffer[:2] == b'\r\n':
        take(2)
    for part in self.parts:
        if take(len(marker) + 2) != marker + b'\r\n':
            raise ValueError('Invalid ECMWF multipart boundary')
        while b'\r\n\r\n' not in buffer:
            if len(buffer) > 1024 * 1024:
                raise ValueError('Oversized ECMWF multipart header')
            fill(len(buffer) + 1)
        end = buffer.index(b'\r\n\r\n') + 4
        header = HeaderParser().parsestr(take(end).decode(self.encoding))
        match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', header.get('Content-Range', ''))
        if match is None:
            raise ValueError('Invalid ECMWF content range')
        start, end, total = map(int, match.groups())
        if start != part.offset or end < start or end >= total or not (end == part.offset + part.length - 1 or end + 1 == total):
            raise ValueError('Unexpected ECMWF content range')
        remaining = end - start + 1
        while remaining:
            fill(1)
            count = min(remaining, len(buffer))
            yield take(count)
            remaining -= count
        if take(2) != b'\r\n':
            raise ValueError('Invalid ECMWF multipart separator')
    if take(len(marker) + 2) != marker + b'--':
        raise ValueError('Missing ECMWF multipart terminator')


def install():
    from multiurl.multipart import MultiPartStreamer
    MultiPartStreamer.__call__ = stream_parts
