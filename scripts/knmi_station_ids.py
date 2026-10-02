"""KNMI WIGOS identifiers confirmed against the EDR station catalogue."""
def station_wigos(station):
    number=int(station)
    # Horst belongs to the KNMI national identifier block, not WMO block 20000.
    block='0-528-0' if number==392 else '0-20000-0'
    return f'{block}-06{number:03d}'
