import json,urllib.request,urllib.parse,pathlib,concurrent.futures
out=pathlib.Path(__file__).parent
points=[('Bristol',51.5,-2.5),('Reading',51.5,-1),('Cuxhaven',53.75,8.75),('Groningen',53.25,6.5),('Arnhem',52,6),('Paris',48.75,2.25),('Alpen',46.75,10.5)]
def fetch(item):
 run,model=item
 params={'latitude':','.join(str(p[1]) for p in points),'longitude':','.join(str(p[2]) for p in points),'hourly':'precipitation,snowfall_water_equivalent,showers','models':model,'run':run,'timezone':'GMT','cell_selection':'nearest','precipitation_unit':'mm'}
 url='https://single-runs-api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(params)
 try:
  with urllib.request.urlopen(url,timeout=60) as r: data=json.load(r)
 except urllib.error.HTTPError as e: print('HTTP',e.code,e.read().decode()[:500]);raise
 report={'run':run,'model':model,'url':url,'requestedPoints':[{'name':n,'lat':lat,'lon':lon} for n,lat,lon in points],'data':data}
 file=f'single-run-{run.replace("-","").replace(":","")}-{model}.json';(out/file).write_text(json.dumps(report,indent=2)+'\n')
 for p,d in zip(points,data):
  i=d['hourly']['time'].index('2026-09-19T14:00')
  print(run,model,p[0],d['latitude'],d['longitude'],d['hourly']['precipitation'][i],flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
 list(executor.map(fetch,[(run,model) for run in ['2026-09-19T00:00','2026-09-18T12:00'] for model in ['ecmwf_ifs','ecmwf_ifs025']]))
