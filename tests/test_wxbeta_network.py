from pathlib import Path
import subprocess,sys,unittest
class NetworkBounds(unittest.TestCase):
 def test_upstream_download_retry_and_probe_are_bounded(self):
  helper=Path(__file__).resolve().parents[1]/'shell'
  script='''import sys
sys.path.insert(0,sys.argv[1])
import ecmwf.opendata.client as m
from wxbeta_network import configure
calls=[]
m.download=lambda *a,**k:calls.append(k)
m.robust=lambda call,**k: calls.append(k)
configure();configure()
m.download('source',target='destination')
m.robust(None,maximum_tries=500)
assert calls[0]['maximum_retries']==3
assert calls[0]['timeout']==45
assert calls[0]['target']=='destination'
assert calls[1]['maximum_tries']==3
'''
  subprocess.run([sys.executable,'-c',script,str(helper)],check=True)
if __name__=='__main__':unittest.main()
