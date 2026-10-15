"""Import official 1991–2020 station PDFs. Requires bs4 and pdftotext (Poppler).
Usage: python3 scripts/import_knmi_klimaattabellen.py --cache /tmp/knmi-klimaat
Symbols remain strings: '.' = not occurred; '*' and '-' retain source meaning.
"""
import argparse, json, pathlib, re, subprocess, urllib.request, hashlib
from bs4 import BeautifulSoup
ROOT=pathlib.Path(__file__).resolve().parents[1]
VIEWER='https://www.knmi.nl/klimaat-viewer'
PERIODS='jan feb mrt apr mei jun jul aug sep okt nov dec winter lente zomer herfst jaar'.split()
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--cache',type=pathlib.Path,default=ROOT/'tmp-klimaat');args=ap.parse_args();args.cache.mkdir(exist_ok=True)
 html=urllib.request.urlopen(VIEWER).read().decode();s=BeautifulSoup(html,'html.parser');links={a['data-file'] for a in s.select('a[data-file]') if 'klimtab_9120_' in a['data-file']}
 stations=[]
 for url in sorted(links):
  name=url.rsplit('/',1)[1];p=args.cache/name
  if not p.exists():urllib.request.urlretrieve(url,p)
  assert p.read_bytes().startswith(b'%PDF')
  text=subprocess.check_output(['pdftotext','-layout',str(p),'-']).decode()
  title=next(l.strip() for l in text.splitlines() if 'langjarige gemiddelden' in l)
  rows=[];pending=None
  for line in text.splitlines():
   m=re.match(r'^\s*('+ '|'.join(PERIODS) +r')\s*(.*)$',line)
   if m:pending=m[1];line=m[2]
   if pending:
    vals=re.findall(r'(?<!\S)(?:-?\d+\.\d+|\.|-|\*)(?!\S)',line)
    if vals:rows.append((pending,vals));pending=None
  assert len(rows)==34,(name,len(rows))
  assert [r[0] for r in rows]==PERIODS*2,name
  assert all(len(v)==(24 if i<17 else 21) for i,(_,v) in enumerate(rows)),(name,[(k,len(v)) for k,v in rows])
  notes=[l.strip() for l in text.splitlines() if re.match(r'^\s*\*\d',l)]
  station={'id':name.removeprefix('klimtab_9120_').removesuffix('.pdf'),'name':title.split(', langjarige')[0], 'source':url,'pdf':name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'notes':notes,'values':[rows[i][1]+rows[i+17][1] for i in range(17)]}
  (ROOT/name).write_bytes(p.read_bytes());stations.append(station)
 stations.sort(key=lambda s:s['name'].casefold())
 (ROOT/'knmi_klimaattabellen.json').write_text(json.dumps({'period':'1991–2020','source':VIEWER,'periods':PERIODS,'stations':stations},ensure_ascii=False,separators=(',',':'))+'\n')
 print(f'{len(stations)} PDFs; {len(stations)*17*45} verified cells')
if __name__=='__main__':main()
