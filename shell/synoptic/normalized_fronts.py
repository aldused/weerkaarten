"""Source-derived front baselines and symbols sized for the destination map."""
import numpy as np
from scipy.ndimage import gaussian_filter1d,map_coordinates,binary_closing
from skimage.morphology import skeletonize
from source_fronts import source_to_screen
PALETTE=[('cold',(0,50,254),'#1666d1'),('warm',(254,50,0),'#da334a'),('occluded',(229,50,229),'#9942bd')]

def baselines(mask):
 """Remove short glyph spurs from the ink skeleton, retaining front branches."""
 points={tuple(p) for p in np.argwhere(skeletonize(binary_closing(mask,iterations=2)))}
 graph={p:set() for p in points}
 for y,x in points:
  for dy,dx in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
   q=(y+dy,x+dx)
   if q not in points:continue
   if dy and dx and ((y+dy,x) in points or (y,x+dx) in points):continue
   graph[(y,x)].add(q)
 # Protect each component's longest baseline, including short isolated fronts.
 protected=set();unseen=set(graph)
 def farthest(start):
  parents={start:None};queue=[start]
  for p in queue:
   for q in graph[p]:
    if q not in parents:parents[q]=p;queue.append(q)
  return queue[-1],parents
 while unseen:
  start=next(iter(unseen));end,component=farthest(start);unseen.difference_update(component)
  end,parents=farthest(end)
  while end is not None:protected.add(end);end=parents[end]
 # A triangle/semicircle contributes a short spur, not a separate front branch.
 for _ in range(4):
  remove=set()
  for start in list(graph):
   if len(graph[start])!=1:continue
   chain=[start];previous=None;current=start;length=0
   while True:
    following=graph[current]-({previous} if previous is not None else set())
    if len(following)!=1:break
    nxt=next(iter(following));length+=np.linalg.norm(np.subtract(nxt,current))
    if len(graph[nxt])!=2:
     if len(graph[nxt])>2 and length<=12 and not any(p in protected for p in chain):remove.update(chain)
     break
    chain.append(nxt);previous,current=current,nxt
    if length>12:break
  if not remove:break
  for p in remove:
   for q in graph[p]:graph[q].discard(p)
  for p in remove:del graph[p]
 visited=set()
 starts=[p for p in graph if len(graph[p])!=2]+list(graph)
 for start in starts:
  for nxt in graph[start]:
   if frozenset((start,nxt)) in visited:continue
   chain=[start];previous,current=start,nxt
   while True:
    visited.add(frozenset((previous,current)));chain.append(current)
    if len(graph[current])!=2:break
    following=graph[current]-{previous};nxt=next(iter(following))
    if frozenset((current,nxt)) in visited:break
    previous,current=current,nxt
   xy=np.asarray(chain,float)[:,::-1]
   distances=np.r_[0,np.cumsum(np.linalg.norm(np.diff(xy,axis=0),axis=1))]
   if distances[-1]<2:continue
   sample=np.arange(0,distances[-1]+.1,.5)
   if len(sample)<4:continue
   xy=np.column_stack([np.interp(sample,distances,xy[:,i]) for i in range(2)])
   yield gaussian_filter1d(xy,6,axis=0,mode='nearest')

def join_paths(paths):
 paths=list(paths)
 # Reconnect the same coloured baseline across contour/label interruptions.
 while True:
  best=None
  for i,a in enumerate(paths):
   for j in range(i+1,len(paths)):
    b=paths[j]
    for reverse_a in [False,True]:
     aa=a[::-1] if reverse_a else a
     ta=aa[-1]-aa[max(0,len(aa)-8)];ta/=max(np.linalg.norm(ta),1e-8)
     for reverse_b in [False,True]:
      bb=b[::-1] if reverse_b else b
      delta=bb[0]-aa[-1];distance=np.linalg.norm(delta)
      if not .01<distance<8:continue
      tb=bb[min(7,len(bb)-1)]-bb[0];tb/=max(np.linalg.norm(tb),1e-8)
      if np.dot(ta,tb)<.2 or np.dot(ta,delta/distance)<-.15 or np.dot(tb,delta/distance)<-.15:continue
      score=distance+3*(1-np.dot(ta,tb))
      if best is None or score<best[0]:best=(score,i,j,aa,bb)
  if best is None:break
  _,i,j,a,b=best;paths[i]=np.vstack([a,b]);del paths[j]
 for xy in paths:
  d=np.r_[0,np.cumsum(np.linalg.norm(np.diff(xy,axis=0),axis=1))]
  sample=np.linspace(0,d[-1],max(4,int(d[-1]*2)))
  xy=np.column_stack([np.interp(sample,d,xy[:,i]) for i in range(2)])
  yield gaussian_filter1d(xy,5,axis=0,mode='nearest')

def side_of_symbols(mask,xy):
 tangent=np.gradient(xy,axis=0);normal=np.column_stack([-tangent[:,1],tangent[:,0]])
 normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-8)
 votes=[]
 for distance in [2,3,4,5,6]:
  plus=xy+normal*distance;minus=xy-normal*distance
  votes.append(np.sum(map_coordinates(mask.astype(float),plus[:,::-1].T,order=1,mode='constant'))-np.sum(map_coordinates(mask.astype(float),minus[:,::-1].T,order=1,mode='constant')))
 return 1 if sum(votes)>=0 else -1

def svg(image):
 rgba=np.asarray(image);parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="880" viewBox="0 0 1400 880"><defs><clipPath id="extent"><rect width="1400" height="880"/></clipPath></defs><g clip-path="url(#extent)">']
 for kind,rgb,color in PALETTE:
  mask=np.all(rgba[:,:,:3]==rgb,axis=2)&(rgba[:,:,3]>90)
  for points in join_paths(baselines(mask)):
   xy=source_to_screen(points)
   if not np.any((xy[:,0]>-30)&(xy[:,0]<1430)&(xy[:,1]>-30)&(xy[:,1]<910)):continue
   side=side_of_symbols(mask,points)
   path='M'+' L'.join(f'{x:.2f},{y:.2f}' for x,y in xy)
   parts.append(f'<path data-front-line="{kind}" d="{path}" fill="none" stroke="white" stroke-opacity=".75" stroke-width="4.4" stroke-linejoin="round" stroke-linecap="round"/><path d="{path}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>')
   lengths=np.linalg.norm(np.diff(xy,axis=0),axis=1);cum=np.r_[0,np.cumsum(lengths)]
   for index,distance in enumerate(np.arange(18,cum[-1]-8,42)):
    j=min(int(np.searchsorted(cum,distance,side='right')-1),len(lengths)-1)
    if lengths[j]<1e-8:continue
    point=xy[j]+(xy[j+1]-xy[j])*(distance-cum[j])/lengths[j]
    tangent=xy[min(j+3,len(xy)-1)]-xy[max(j-3,0)];angle=np.degrees(np.arctan2(tangent[1],tangent[0]))
    triangle=kind=='cold' or (kind=='occluded' and index%2==0)
    glyph='M -6,0 L 0,8 L 6,0 Z' if triangle else 'M -6,0 A 6,6 0 0 0 6,0 Z'
    parts.append(f'<path data-front-symbol="{kind}" d="{glyph}" transform="translate({point[0]:.2f},{point[1]:.2f}) rotate({angle:.2f}) scale(1,{side})" fill="{color}" stroke="white" stroke-width=".5" paint-order="stroke fill"/>')
 parts.append('</g></svg>');return ''.join(parts)
