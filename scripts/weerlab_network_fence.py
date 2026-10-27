"""Provider-specific network fence for the shared Weerlab data helper."""
from urllib.parse import urlsplit
import urllib.request

def check(url):
 host=(urlsplit(str(getattr(url,'full_url',url))).hostname or '').lower().rstrip('.')
 if host=='open-meteo.com' or host.endswith('.open-meteo.com'):
  raise RuntimeError('Open-Meteo is uitgeschakeld; gebruik een eigen rechtstreekse Weerlab-bron')
if not getattr(urllib.request.OpenerDirector.open,'_weerlab_native_only',False):
 original_open=urllib.request.OpenerDirector.open
 def native_open(self,url,*a,**kw):
  check(url);return original_open(self,url,*a,**kw)
 native_open._weerlab_native_only=True;urllib.request.OpenerDirector.open=native_open
import requests
if not getattr(requests.sessions.Session.send,'_weerlab_native_only',False):
 original_send=requests.sessions.Session.send
 def native_send(self,request,*a,**kw):
  check(request.url);return original_send(self,request,*a,**kw)
 native_send._weerlab_native_only=True;requests.sessions.Session.send=native_send
