"""Install the provider-specific browser fence in the deployment artifact, not source pages."""
from pathlib import Path
import re
TAG='<script src="/weerlab-native-only.js?v=20261027-1"></script>'
def apply(root):
 count=0
 for p in Path(root).rglob('*.html'):
  if any(part.startswith('.') or part in ['node_modules','_deploy'] for part in p.relative_to(root).parts):continue
  s=p.read_text(errors='surrogateescape')
  if '/weerlab-native-only.js?' in s:continue
  updated,n=re.subn(r'(<head\b[^>]*>)',lambda m:m[1]+TAG,s,count=1,flags=re.I)
  if n:p.write_text(updated,errors="surrogateescape");count+=1
 return count
if __name__=='__main__':print('Native-only browserbewaking:',apply(Path('.')),'pagina’s')
