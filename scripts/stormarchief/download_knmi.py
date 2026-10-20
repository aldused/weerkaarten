from pathlib import Path
from urllib.request import urlopen
import re, json, hashlib, concurrent.futures
root=Path(__file__).resolve().parent/'source'
root.mkdir(parents=True,exist_ok=True)
s=urlopen('https://www.knmi.nl/nederland-nu/klimatologie/daggegevens/',timeout=60).read().decode()
(root/'knmi-index.html').write_text(s)
items=re.findall(r"href=['\"](//cdn\.knmi\.nl/[^'\"]*etmgeg_(\d+)\.zip)['\"]>([^<]+)",s)
def download(item):
 url,station,name=item
 data=urlopen('https:'+url,timeout=60).read()
 path=root/f'etmgeg_{station}.zip'; path.write_bytes(data)
 return {'station':int(station),'name':name.strip(),'url':'https:'+url,'sha256':hashlib.sha256(data).hexdigest(),'file':path.name}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 records=list(pool.map(download,items))
(root/'manifest.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
print(f'{len(records)} KNMI-stationbestanden opgehaald')
