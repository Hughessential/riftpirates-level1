#!/usr/bin/env python3
"""Dev server for Rift Pirates.

Same as `python3 -m http.server 8000`, but with caching disabled so code
edits always show up on a plain reload (browsers heuristically cache ES
modules served with Last-Modified headers, which makes previews run stale
code).
"""
import http.server


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    http.server.test(HandlerClass=NoCacheHandler, port=8000)
