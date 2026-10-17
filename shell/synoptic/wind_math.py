"""Meteorological mean wind: native m/s to Beaufort, FROM to flow direction."""
import bisect,math
THRESHOLDS=(.3,1.6,3.4,5.5,8,10.8,13.9,17.2,20.8,24.5,28.5,32.7)
def beaufort(speed_ms):
 if not math.isfinite(speed_ms) or speed_ms<0:raise ValueError('Ongeldige gemiddelde windsnelheid')
 return bisect.bisect_right(THRESHOLDS,speed_ms)
def flow_bearing(from_degrees):
 if not math.isfinite(from_degrees):raise ValueError('Ongeldige windrichting')
 return (from_degrees+180)%360
