import unittest
from types import SimpleNamespace
from ecmwf_multipart import stream_parts


class MultipartTest(unittest.TestCase):
    def reader(self, body, width=1):
        response = SimpleNamespace(iter_content=lambda _: (body[i:i+width] for i in range(0, len(body), width)))
        return SimpleNamespace(request=response, boundary='boundary', encoding='utf-8', parts=[SimpleNamespace(offset=0, length=5), SimpleNamespace(offset=9, length=4)])

    def body(self):
        return b'\r\n--boundary\r\nContent-Range: bytes 0-4/20\r\n\r\nGRIB1\r\n--boundary\r\nContent-Range: bytes 9-12/20\r\n\r\nGRIB\r\n--boundary--\r\n'

    def test_every_chunk_width(self):
        body = self.body()
        for width in range(1, len(body)+1):
            with self.subTest(width=width):
                self.assertEqual(b''.join(stream_parts(self.reader(body, width), width)), b'GRIB1GRIB')

    def test_truncation_rejected(self):
        with self.assertRaises(EOFError):
            b''.join(stream_parts(self.reader(self.body()[:-10]), 1))

    def test_wrong_range_rejected(self):
        with self.assertRaises(ValueError):
            b''.join(stream_parts(self.reader(self.body().replace(b'9-12', b'8-11')), 1))

    def test_bad_separator_rejected(self):
        with self.assertRaises(ValueError):
            b''.join(stream_parts(self.reader(self.body().replace(b'GRIB1\r\n', b'GRIB1xx')), 1))

if __name__ == '__main__':
    unittest.main()
