import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'shell'))
import ecmwf_pluim_direct as d
class ParallelBatches(unittest.TestCase):
 def test_out_of_order_batches_preserve_all_members_and_exact_steps(self):
  raw={'2t':np.full((51,2,3),np.nan)};points=('same-grid',)
  for steps,value in [((6,),6),((0,),0),((3,),3)]:
   got={'steps':steps,'raw':{'2t':np.full((51,2,1),value)},'grid_points':points}
   self.assertEqual(d.merge_native_batch(raw,{0:0,3:1,6:2},points,got),points)
  np.testing.assert_array_equal(raw['2t'],np.broadcast_to([0,3,6],(51,2,3)))
 def test_invalid_result_cannot_partially_modify_checkpoint_arrays(self):
  raw={'2t':np.full((51,2,1),np.nan),'tp':np.full((51,2,1),np.nan)}
  with self.assertRaises(RuntimeError):d.merge_native_batch(raw,{0:0},('a',),{'steps':(0,),'grid_points':('a',),'raw':{'2t':np.ones((51,2,1)),'tp':np.ones((50,2,1))}})
  self.assertTrue(np.isnan(raw['2t']).all())
  with self.assertRaises(RuntimeError):d.merge_native_batch(raw,{0:0},('a',),{'steps':(0,),'grid_points':('b',),'raw':{}})
if __name__=='__main__':unittest.main()

class BoundedQueue(unittest.TestCase):
 def test_does_not_schedule_entire_run_before_first_result(self):
  from concurrent.futures import Future
  submitted=[]
  def submit(pool,job):
   submitted.append(job[0]);f=Future();f.set_result(job[0]);return f
  it=d.bounded_batch_results(None,[(i,) for i in range(20)],submit,4)
  first=next(it);self.assertEqual(len(submitted),4)
  results=[first]+list(it);self.assertEqual(sorted(n for n,r in results),list(range(20)))

class RetryableFailures(unittest.TestCase):
 def test_progressive_keeps_successful_jobs_after_failure(self):
  from concurrent.futures import Future
  errors=[]
  def submit(pool,job):
   f=Future()
   if job[0]==1:f.set_exception(RuntimeError('retry later'))
   else:f.set_result(job[0])
   return f
  results=list(d.bounded_batch_results(None,[(i,) for i in range(6)],submit,2,on_error=lambda number,error:errors.append(number)))
  self.assertEqual(sorted(n for n,r in results),[0,2,3,4,5])
  self.assertEqual(errors,[1])
 def test_default_producer_still_fails_closed(self):
  from concurrent.futures import Future
  def submit(pool,job):
   f=Future();f.set_exception(RuntimeError('bad batch'));return f
  with self.assertRaises(RuntimeError):list(d.bounded_batch_results(None,[(0,)],submit,1))
