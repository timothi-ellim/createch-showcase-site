"""Compare generated preview with freshly captured public HTML and approved snapshot."""
import csv, datetime, io, json, re, zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

root = Path('.build-candidates/sharing-preview')
site = root / 'site'
snapshot = json.loads((root / 'snapshot.json').read_text(encoding='utf-8'))
live = json.loads((root / 'live-baseline.json').read_text(encoding='utf-8'))
marker = json.loads(live['/content-revision.json'])
assert marker['revision'] == snapshot['revision']

class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source, self.depth, self.start, self.body, self.meta = source, 0, None, None, {}
        self.offsets = [0] + [m.end() for m in re.finditer('\n', source)]
        self.feed(source)
    def offset_at(self):
        line, column = self.getpos()
        return self.offsets[line-1] + column
    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'meta':
            self.meta[attributes.get('name') or attributes.get('property')] = attributes.get('content')
        if self.start is None and 'data-project-body' in attributes:
            self.start, self.depth = self.offset_at() + len(self.get_starttag_text()), 1
        elif self.depth and tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:
            self.depth += 1
    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1
            if self.depth == 0:
                self.body = self.source[self.start:self.offset_at()]

shortcut = '<a class="button secondary" href="#share-project-heading" data-share-shortcut>Share this project</a>'
checks = []
for project in snapshot['projects']:
    route = '/projects/' + project['slug'] + '/'
    before = Page(live[route])
    after = Page((site / route.strip('/') / 'index.html').read_text(encoding='utf-8'))
    assert before.body and after.body and after.body.count(shortcut) == 1
    assert after.body.replace(shortcut, '') == before.body, ('PROJECT_BODY_CHANGED', project['id'])
    keys = ['description','og:title','og:description','twitter:title','twitter:description','og:image:alt','twitter:image:alt']
    for key in keys:
        assert before.meta.get(key) == after.meta.get(key), ('METADATA_CHANGED', project['id'], key)
    for key in ['og:image','twitter:image']:
        # Preview uses a relative asset address; publication uses the same path at the public origin.
        assert before.meta[key] == urljoin(snapshot['event']['publicSiteUrl'],after.meta[key])
    assert after.meta['createch-revision'] == snapshot['revision']
    assert re.search(r'<title>(.*?)</title>', before.source)[1] == re.search(r'<title>(.*?)</title>', after.source)[1]
    checks.append({'slug':project['slug'], 'participantHtmlUnchanged':True, 'metadataUnchanged':True})

html_pages = list(site.rglob('*.html'))
assert all('noindex' in p.read_text(encoding='utf-8') for p in html_pages)
with zipfile.ZipFile(site / 'sharing/pack.zip') as pack:
    assert pack.testzip() is None
    assert len(pack.namelist()) == 8
    rows = list(csv.reader(io.StringIO(pack.read('project-links.csv').decode('utf-8'))))
    assert rows[0] == ['Participant','Project','Link']
    expected = [[p['maker'],p['title'],snapshot['event']['publicSiteUrl'].rstrip('/')+'/projects/'+p['slug']+'/'] for p in snapshot['projects']]
    assert rows[1:] == expected
    for name in ['invitation.txt','social-caption.txt','event-listing.txt']:
        text = pack.read(name).decode('utf-8')
        assert snapshot['event']['dateLabel'] in text and snapshot['event']['publicSiteUrl'] in text
    for format in ['preview','square','portrait']:
        assert pack.read('createch-'+format+'.png') == (site / ('sharing/'+format+'.png')).read_bytes()
result = {'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'revision':snapshot['revision'], 'projects':checks, 'previewPagesNoindex':len(html_pages), 'zipEntries':8, 'projectCsvExact':True, 'zipGraphicsMatchDownloads':True, 'published':False}
target = Path('../../docs/evidence/discovery-sharing-preview/verification.json')
target.write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({'participantPagesUnchanged':len(checks),'previewPagesNoindex':len(html_pages),'zipEntries':8,'projectCsvExact':True}))
