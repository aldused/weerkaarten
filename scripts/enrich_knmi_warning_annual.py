#!/usr/bin/env python3
"""Add KNMI's own short retrospective and figures to imported annual records.

KNMI website text is CC0 unless otherwise stated: https://www.knmi.nl/copyright.
Only article figures are referenced; hero photos are excluded. The annual table
remains the authority for dates, codes and areas. No warning boundary is inferred
from a retrospective image. Existing cache permits repeatable offline extraction.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []

    def nodes(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.nodes()

    def text(self):
        if self.tag in ('script', 'style', 'noscript'):
            return ''
        return re.sub(r'\s+', ' ', ' '.join(c.text() if isinstance(c, Node) else c for c in self.children)).strip()

    def has_class(self, name):
        return name in self.attrs.get('class', '').split()


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Node()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in ('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'):
            self.current = node

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        node = self.current
        while node.parent:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, text):
        self.current.children.append(text)


def short_text(text, words=180):
    if len(text.split()) <= words:
        return text
    prefix = ' '.join(text.split()[:words])
    # Stop at a sentence when possible rather than introducing half a claim.
    end = max(prefix.rfind('. '), prefix.rfind('! '), prefix.rfind('? '))
    return prefix[:end + 1] if end > len(prefix) // 2 else prefix + '…'


def secure_url(url, base, host):
    resolved = urljoin(base, url)
    if urlsplit(resolved).hostname == host and resolved.startswith('http://'):
        resolved = 'https://' + resolved[7:]
    parsed = urlsplit(resolved)
    return resolved if parsed.scheme == 'https' and parsed.hostname == host else None


def extract(html, source):
    document = Document(html)
    main = next((node for node in document.root.nodes() if node.tag == 'main'), None)
    article = next((node for node in main.nodes() if node.has_class('datacenter-detail')), None) if main else None
    if not article:
        article = next((node for node in main.nodes() if node.tag == 'article'), None) if main else None
    if not article:
        article = main if main and any(node.tag == 'p' and node.has_class('intro') for node in main.nodes()) else None
    if not article:
        raise ValueError('Geen KNMI-terugblik gevonden')
    paragraphs, intro, impact, section = [], '', [], ''
    blocks = [article]
    for block in blocks:
        for node in block.nodes():
            if node.tag in ('h2', 'h3'):
                section = node.text().lower()
            elif node.tag == 'p':
                text = node.text()
                if node.has_class('intro'):
                    intro = text
                elif 'impact' in section:
                    impact.append(text)
                elif text:
                    paragraphs.append(text)
    figures, seen = [], set()
    for figure in (node for node in article.nodes() if node.tag == 'figure'):
        link = next((node for node in figure.nodes() if node.tag == 'a' and node.has_class('figure__link')), None)
        image = next((node for node in figure.nodes() if node.tag == 'img'), None)
        caption = next((node.text() for node in figure.nodes() if node.tag == 'figcaption'), '')
        if not link or not image:
            continue
        caption = caption or image.attrs.get('alt', '')
        url = secure_url(link.attrs.get('href', ''), source, 'cdn.knmi.nl')
        thumbnail = secure_url(image.attrs.get('data-src') or image.attrs.get('src', ''), source, 'cdn.knmi.nl')
        if not url or url in seen or not caption or re.search(r'foto|copyright|©', caption, re.I):
            continue
        seen.add(url)
        figures.append({'url': url, 'thumbnail': thumbnail or url, 'caption': caption})
    warning_figures = [item for item in figures if re.search(r'waarschuw|code (?:oranje|rood|geel)', item['caption'], re.I) or re.search(r'waarschuw', item['url'], re.I)]
    other_figures = [item for item in figures if item not in warning_figures]
    figures = warning_figures + other_figures[:6]
    summary = intro or next(iter(paragraphs), '')
    body = paragraphs if intro else paragraphs[1:]
    return {'description': short_text(summary, 60), 'detail': short_text(' '.join(body[:3])),
            'impact': short_text(' '.join(impact[:1]), 100), 'factsheet_images': figures,
            'context_source': source}


def enrich(record, cache):
    record = dict(record)
    if not record.get('factsheet'):
        return record, None
    source = secure_url(record['factsheet'], record['source'], 'www.knmi.nl')
    if not source:
        return record, 'Onbekend bronadres'
    record['factsheet'] = source
    path = cache / (hashlib.sha256(source.encode()).hexdigest() + '.html')
    try:
        if not path.exists():
            request = Request(source, headers={'User-Agent': 'Weerlab-warning-archive/1.1'})
            with urlopen(request, timeout=30) as response:
                html = response.read().decode('utf-8')
            extract(html, source)  # Never cache an error page as article content.
            path.write_text(html)
        context = extract(path.read_text(), source)
        record.update({key: value for key, value in context.items() if value})
        return record, None
    except Exception as error:
        return record, type(error).__name__ + ': ' + str(error)[:150]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--annual', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    data = json.loads(args.annual.read_text())
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda record: enrich(record, args.cache), data['records']))
    data['records'] = [record for record, error in results]
    args.annual.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    report = {'records': len(results), 'with_context': sum(bool(record.get('description')) for record, _ in results),
              'with_figures': sum(bool(record.get('factsheet_images')) for record, _ in results),
              'errors': [{'id': record['id'], 'source': record.get('factsheet'), 'error': error} for record, error in results if error]}
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
