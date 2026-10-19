"""Bound upstream ECMWF retries so one source outage cannot block later cycles."""
def configure():
 import ecmwf.opendata.client as module
 from functools import wraps
 if getattr(module,'_wxbeta_bounded',False):return
 download=module.download
 @wraps(download)
 def bounded_download(*args,**kwargs):
  kwargs.setdefault('maximum_retries',3)
  kwargs.setdefault('retry_after',(2,10,2))
  kwargs.setdefault('timeout',45)
  kwargs.setdefault('chunk_size',256*1024)
  return download(*args,**kwargs)
 module.download=bounded_download
 robust=module.robust
 def bounded_robust(call,maximum_tries=3,retry_after=120,mirrors=None,use_server_retry_after=False):
  return robust(call,maximum_tries=min(int(maximum_tries),3),retry_after=(2,10,2),mirrors=mirrors,use_server_retry_after=use_server_retry_after)
 module.robust=bounded_robust
 original_init=module.Client.__init__
 @wraps(original_init)
 def bounded_init(self,*args,**kwargs):
  original_init(self,*args,**kwargs)
  request=self.session.request
  def bounded_request(*args,**kwargs):
   kwargs.setdefault('timeout',45)
   return request(*args,**kwargs)
  self.session.request=bounded_request
 module.Client.__init__=bounded_init
 module._wxbeta_bounded=True
