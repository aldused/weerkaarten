"""Keep only complete calendar periods when ranking climate means or totals."""
import pandas as pd


def complete_days(series: pd.Series, period: str) -> pd.Series:
    values = series.dropna().sort_index()
    if values.index.has_duplicates:
        raise ValueError("Dubbele meetdatums in klimaatreeks")
    idx = values.index
    if period == "month":
        keys, expected = idx.to_period("M"), idx.days_in_month
    elif period == "year":
        keys, expected = idx.year, 365 + idx.is_leap_year.astype(int)
    elif period == "season":
        keys = idx.to_period("Q-NOV")  # December–February belongs to one winter.
        expected = (keys.end_time.normalize() - keys.start_time).days + 1
    elif period == "decade":
        decade = (idx.day > 10).astype(int) + (idx.day > 20).astype(int)
        keys = idx.strftime("%Y-%m-") + decade.astype(str)
        expected = [10 if d < 2 else days - 20 for d, days in zip(decade, idx.days_in_month)]
    else:
        raise ValueError(f"Onbekende kalenderperiode: {period}")
    count = values.groupby(keys).transform("count")
    return values.loc[count.to_numpy() == expected]
