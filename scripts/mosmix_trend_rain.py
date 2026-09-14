"""RR1c covers the hour ending at its timestamp; keep missing intervals unknown."""
import datetime as dt
import math

def rain_by_day(times, values, local_zone):
    sums = {}
    unknown = set()
    previous = None
    for index, stamp in enumerate(times):
        end = stamp.replace(tzinfo=dt.timezone.utc) if stamp.tzinfo is None else stamp.astimezone(dt.timezone.utc)
        day = (end - dt.timedelta(microseconds=1)).astimezone(local_zone).date()
        value = values[index] if index < len(values) else None
        if previous is not None and end - previous != dt.timedelta(hours=1):
            # RR1c is a one-hour value, never a total for an unspecified gap.
            missing = previous + dt.timedelta(hours=1)
            while missing < end:
                unknown.add((missing-dt.timedelta(microseconds=1)).astimezone(local_zone).date())
                missing += dt.timedelta(hours=1)
            if end <= previous:
                unknown.add(day)
        if isinstance(value, (int,float)) and not isinstance(value,bool) and math.isfinite(value) and value >= 0:
            sums[day] = sums.get(day, 0) + value
        else:
            unknown.add(day)
        previous = end
    return {day: None if day in unknown else round(sums[day],1) for day in sums.keys() | unknown}
