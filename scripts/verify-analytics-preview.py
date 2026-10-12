import json,re,sys
from pathlib import Path
from html.parser import HTMLParser
root=Path.cwd()
site=root/'.build-candidates/analytics-preview/site'
if len(sys.argv) != 2: raise SystemExit('Supply the folder containing the approved snapshot and saved live HTML.')
baseline=Path(sys.argv[1]).resolve()
snapshot=json.loads((baseline/'snapshot.private.json').read_text(encoding='utf-8-sig'))
responses=json.loads((baseline/'live-responses.json').read_text(encoding='utf-8-sig'))
class Body(HTMLParser):
 def __init__(self,source):
  super().__init__(convert_charrefs=False);self.source=source;self.depth=0;self.start=None;self.body=None;self.meta={};self.offsets=[0]
  for m in re.finditer('\n',source):self.offsets.append(m.end())
  self.feed(source)
 def offset_of(self):
  line,col=self.getpos();return self.offsets[line-1]+col
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='meta':self.meta[a.get('name') or a.get('property')]=a.get('content')
  if self.start is None and 'data-project-body' in a:self.start=self.offset_of()+len(self.get_starttag_text());self.depth=1
  elif self.depth and tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:self.depth+=1
 def handle_endtag(self,tag):
  if self.depth:
   self.depth-=1
   if self.depth==0:self.body=self.source[self.start:self.offset_of()]
for p in snapshot['projects']:
 route='/projects/'+p['slug']+'/'
 before=Body(responses[route]);after=Body((site/route.strip('/')/'index.html').read_text(encoding='utf-8'))
 assert before.body and before.body==after.body,('PARTICIPANT_BODY_CHANGED',p['id'])
 for key in ['description','og:description','twitter:description']:
  assert before.meta[key]==after.meta[key],('PARTICIPANT_METADATA_CHANGED',p['id'],key)
 assert after.meta['createch-revision']==snapshot['revision']
for p in site.rglob('*.html'):
 source=p.read_text(encoding='utf-8')
 assert 'googletagmanager.com/gtag/js' not in source,p
 assert 'noindex, nofollow' in source,p
for route in ['participant','organiser']:
 assert 'data-analytics-choice' not in (site/route/'index.html').read_text(encoding='utf-8')
result={'participantPagesUnchanged':len(snapshot['projects']),'participantMetadataUnchanged':True,'contentRevision':snapshot['revision'],'allPreviewPagesOmitGoogleTag':True,'privatePagesOmitConsentControls':True,'deployed':False}
(root/'.build-candidates/analytics-preview/verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result))
