"""Read-only checks against an already built, approved-content preview."""
import argparse
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.anchors = []
        self.errors = []
        self.ids = []
        self.links = []
        self.paragraphs = []
        self.paragraph = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'a':
            if self.anchors:
                self.errors.append('Nested anchor: ' + str(attrs.get('href')))
            self.anchors.append(attrs)
            self.links.append(attrs)
        if tag in ('button', 'input', 'select', 'textarea') and self.anchors:
            self.errors.append('Interactive control inside anchor: ' + tag)
        if tag == 'figcaption' and self.anchors:
            self.errors.append('Credit inside artwork navigation')
        if tag == 'p' and 'data-event-paragraph' in attrs:
            self.paragraph = []

    def handle_endtag(self, tag):
        if tag == 'a' and self.anchors:
            self.anchors.pop()
        if tag == 'p' and self.paragraph is not None:
            self.paragraphs.append(' '.join(''.join(self.paragraph).split()))
            self.paragraph = None

    def handle_data(self, data):
        if self.paragraph is not None:
            self.paragraph.append(data)


parser = argparse.ArgumentParser()
parser.add_argument('--site', required=True, type=Path)
parser.add_argument('--snapshot', required=True, type=Path)
args = parser.parse_args()
snapshot_bytes = args.snapshot.read_bytes()
snapshot = json.loads(snapshot_bytes)
assert snapshot['publicationStatus'] == 'approved-public'
pages = list(args.site.rglob('*.html'))
for path in pages:
    page = Page(path.read_text(encoding='utf-8'))
    assert not page.errors, (str(path), page.errors)
    assert len(page.ids) == len(set(page.ids)), ('Duplicate IDs', str(path))
    for link in page.links:
        href = link.get('href', '')
        if href.startswith('#') and len(href) > 1:
            assert href[1:] in page.ids, ('Missing anchor', str(path), href)

html = (args.site / 'index.html').read_text(encoding='utf-8')
home = Page(html)
assert home.paragraphs == [' '.join(p.split()) for p in snapshot['event']['description'].split('\n\n') if p.strip()]
assert html.index('id="selected-projects-heading"') < html.index('id="poster"')
assert html.index('class="theme-grid"') < html.index('id="play"')
assert all(identifier in home.ids for identifier in ('news-social', 'supporters', 'participants', 'play'))
assert len([link for link in home.links if 'data-project-media-link' in link]) == 3
assert any(link.get('href') == 'https://creativecommons.org/licenses/by/2.0/' for link in home.links)
assert any(link.get('href') == 'https://canopy.leicestercreative.business/events/createch-showcase-2026/' for link in home.links)
assert any(link.get('href') == 'https://linktr.ee/lcbdepot' for link in home.links)
assert any(link.get('href', '').startswith('https://www.linkedin.com/posts/tgharwood_') for link in home.links)
media = {item['src'] for project in snapshot['projects'] for item in [project.get('media'), *project.get('processMedia', [])] if item}
for src in media:
    content = (args.site / src.lstrip('/')).read_bytes()
    assert hashlib.sha256(content).hexdigest() == Path(src).stem, ('Media changed', src)
assert args.snapshot.read_bytes() == snapshot_bytes
print(json.dumps({'htmlPagesChecked': len(pages), 'validCardLinks': True, 'uniqueIds': True, 'samePageAnchorsResolve': True, 'eventParagraphsUnchanged': True, 'approvedMedia': len(media), 'projects': len(snapshot['projects']), 'contentRevision': snapshot['revision'], 'published': False}, indent=2))
