"""Shared Open-Meteo transport for ordinary ECMWF maps."""
import sys,time,datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"scripts"))
from open_meteo import upgrade_url,bulk_sessie
UTC=dt.timezone.utc
def fetch(url):
 if 'open-meteo.com' in url:
  from native_point_source import fetch_native
  native=fetch_native(url)
  if native is not None:return native
 url=upgrade_url(url)
 for attempt in range(3):
  try:
   response=bulk_sessie().get(url,headers={'User-Agent':'Weerlab wind comparison/1.0','Cache-Control':'no-cache'},timeout=90)
   if response.status_code in (400,401,403,429):
    raise ValueError(f'Bron {response.status_code}: {response.json().get("reason","aanvraag geweigerd")}')
   response.raise_for_status();return response.json()
  except ValueError:raise
  except Exception:
   if attempt==2:raise RuntimeError('De bronverbinding is na drie pogingen mislukt') from None
   time.sleep(2*(attempt+1))

def parse(s):return dt.datetime.fromisoformat(s.replace('Z','+00:00')).replace(tzinfo=UTC)
def iso(t):return t.isoformat().replace('+00:00','Z')
