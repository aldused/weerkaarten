#!/usr/bin/env python3
"""
Bouwt records_nl_extreme.json — gecureerde historische extreme dag-temperaturen
per maand-decade voor Nederlandse stations (incl. oude/opgeheven stations).

Bevat:
- tx_hoog: hoogste maximumtemperatuur per decade (warmte-records)
- tn_laag: laagste minimumtemperatuur per decade (koude-records)

Output past in bestaande records-pagina (records_debilt.html) via aparte
"Historische extremen NL"-optie in Historische stations-optgroup.
"""
import json
import re
from datetime import datetime, timezone

# ─────────────────────────────────────────────────────────────────────────────
# Warmte-records — formaat: "5 januari 1999: Station 16,4°C"
# ─────────────────────────────────────────────────────────────────────────────
WARM_RAW = """
== Januari 1 ==
5 januari 1999: Oost-Maarland 16,4°C
6 januari 1999: Oost-Maarland 15,9°C
10 januari 1991: Oost-Maarland 14,7°C

== Januari 2 ==
16 januari 1947: Sittard 16,0°C

== Januari 3 ==
29 januari 1955: Buchten 15,5°C
21 januari 1899: Winterswijk 13,5

== Februari 1 ==
10 februari 1899: Winterswijk 19,2°C
10 februari 1899: Maastricht 18,5°C
10 februari 1899: De Bilt 17,8°C
9 februari 1989: Epen 17,6°C
8 februari 1990: Epen 15,4°C

== Februari 2 ==
18 februari 1950: Buchten 19,2°C
17 februari 1961: Ermelo 19,1°C
14 februari 1961: Maastricht Caberg 18,8°C
17 februari 1950: Buchten 18,5°C
19 februari 1920: Winterswijk 16,3°C
11 februari 1899: Winterswijk 16,0°C

== Februari 3 ==
24 februari 1990: Oost-Maarland 20,4°C
24 februari 1990: Epen 20,0°C
26 februari 1900: Winterswijk 20,3°C
28 februari 1960: Epen 19,5°C

== Maart 1 ==
6 maart 1989: Oost-Maarland 20,0°C
3 maart 1952: Epen 19,0°C
5 maart 1992: Oost-Maarland 18,9°C
4 maart 1939: Gemert en Sittard 17,6°C

== Maart 2 ==
17 maart 1990: Kapellebrug 23,1°C
17 maart 1990: Oost-Maarland 22,6°C
17 maart 1961: Venlo 22,8°C
20 maart 1916: Breda 21,7°C
15 maart 1972: Epen 20,2°C

== Maart 3 ==
29 maart 1968: Gemert en Venlo 25,6°C
29 maart 1968: Soesterberg 25,4°C
26 maart 1953: Venlo 24,5°C
24 maart 1896: Winterswijk 23,4°C
25 maart 1896: Winterswijk 23,2°C
23 maart 1896: Winterswijk 22,3°C
22 maart 1936: 's Heerenberg 21,8°C

== April 1 ==
9 april 1894: Winterswijk 25,8°C
4 april 1946: Warnsveld 25,5°C
9 april 1969: Buchten 24,9°C
7 april 1894: Winterswijk 24,4°C

== April 2 ==
18 april 1949: Venlo 29,5°C
18 april 1949: Buchten 29,2°C
17 april 1949: Gemert en Buchten 29,2°C
12 april 1939: 's-Heerenberg 26,6°C
12 april 1939: Gemert 26,1°C
12 april 1939: Wijster 25,8°C
12 april 1939: Winterswijk en Sittard 25,3°C

== April 3 ==
21 april 1968: Venlo 32,2°C
21 april 1968: Buchten 31,7°C
21 april 1968: Almen 30,8°C
21 april 1968: Emmen 30,6°C
21 april 1968: Gemert 30,5°C

== Mei 1 ==
10 mei 1976: Gemert 32,0°C
5 mei 1916: Avereest 30,3°C

== Mei 2 ==
13 mei 1945: Warnsveld 32,9°C
13 mei 1969: Buchten 32,7°C
13 mei 1969: Venlo 32,0°C
13 mei 1969: Epen 31,6°C
13 mei 1969: Gemert 31,4°C
13 mei 1907: Gemert 31,8°C

== Mei 3 ==
24 mei 1922: Gemert en Sittard 35,6°C
23 mei 1922: Winterswijk 33,7°C
30 mei 1944: Gemert 34,3°C
30 mei 1944: Sittard 33,0°C
29 mei 1944: Hoek van Holland 32,2°C
29 mei 1944: Rottum 31,5°C
25 mei 1921: Sittard 31,4°C
25 mei 1921: Avereest 31,0°C
25 mei 1921: Warnsveld 30,9°C
25 mei 1921: Gemert 30,8°C
28 mei 1931: Winterswijk 31,4°C

== Juni 1 ==
8 juni 1915: Oudenbosch 36,1°C
10 juni 1937: Gemert 33,1°C
1 juni 1902: Winterswijk 32,8°C
4 juni 1902: Winterswijk 32,7°C

== Juni 2 ==
13 juni 1964: Buchten 34,4°C
11 juni 1948: Venlo 33,4°C
12 juni 1919: Sittard 32,7°C
12 juni 1919: Winterswijk 32,1°C
15 juni 1896: Winterswijk 31,3°C

== Juni 3 ==
27 juni 1947: Venlo 37,9°C
27 juni 1947: Wageningen 37,8°C
27 juni 1947: Rotterdam 37,7°C
27 juni 1947: Sittard 37,6°C
30 juni 1957: Oudenbosch en St. Jansteen 35,2°C
23 juni 1941: Gemert 34,3°C
23 juni 1941: Sittard 33,0°C
21 juni 1998: Oost-Maarland 33,0°C

== Juli 1 ==
9 juli 1959: Venlo 36,6°C
4 juli 1946: Warnsveld 35,8°C
2 juli 1952: Buchten 35,3°C
6 juli 1952: Gilze-Rijen 35,3°C
10 juli 1941: Warnsveld 34,9°C
5 juli 1976: Epen 34,0°C

== Juli 2 ==
18 juli 1964: Venlo 36,6°C
13 juli 1923: Sittard 36,2°C
11 juli 1921: Sittard 35,7°C
15 juli 1945: Kortgene 35,1°C
12 juli 1941: Rottum 35,0°C
17 juli 1983: Venlo 34,8°C
14 juli 1923: Winterswijk 34,2°C

== Juli 3 ==
28 juli 1911: Breda 36,8°C
28 juli 1911: Goes 36,2°C
23 juli 1911: Sittard 35,9°C

== Augustus 1 ==
3 augustus 1986: Echt 36,6°C
8 augustus 1937: 's-Heerenberg 36,6°C
10 augustus 1911: Breda 35,9°C
10 augustus 1911: Sittard 35,6°C
10 augustus 1998: Oost-Maarland 35,0°C

== Augustus 2 ==
16 augustus 1898: Winterswijk 35,0°C
15 augustus 1898: Winterswijk 34,0°C

== Augustus 3 ==
23 augustus 1944: Warnsveld 38,6°C
23 augustus 1944: Winterswijk 37,6°C
23 augustus 1944: Gemert en Sittard 36,9°C
27 augustus 1964: Buchten 35,6°C
24 augustus 1944: Winterswijk 33,8°C
21 augustus 1943: Winterswijk 33,6°C
22 augustus 1898: Winterswijk 33,7°C
22 augustus 1918: Winterswijk 33,2°C

== September 1 ==
5 september 1949: Buchten en Gilze-Rijen 34,8°C
5 september 1949: Hoek van Holland en Rotterdam 34,7°C
8 september 1911: Sittard 34,2°C
8 september 1911: Breda 33,5°C
8 september 1934: Sittard 34,1°C
2 september 1906: Breda 33,6°C
2 september 1911: Slijk-Ewijk 33,6°C
2 september 1911: Gemert 33,0°C
4 september 1929: Sittard 33,0°C
7 september 1911: Sittard 31,6°C
9 september 1898: Winterswijk 31,1°C

== September 2 ==
12 september 1919: Sittard 33,6°C
16 september 1947: Warnsveld 33,3°C
16 september 1947: Venlo 33,1°C
20 september 1926: Sittard 33,0°C
20 september 1926: Twenthe 32,0°C
11 september 1919: Winterswijk en Sittard 32,4°C
13 september 1947: Sittard 32,4°C
13 september 1919: Winterswijk 32,1°C
19 september 1961: Buchten 32,0°C
19 september 1947: Twenthe 32,0°C

== September 3 ==
26 september 1967: Buchten 30,4°C
21 september 1987: Oost-Maarland 29,4°C
26 september 1895: Winterswijk 29,3°C
21 september 1901: Winterswijk 29,1°C
25 september 1895: Winterswijk 28,4°C
29 september 1934: Winterswijk 28,0°C
27 september 1895: Winterswijk 27,9°C
30 september 1895: Winterswijk 26,7°C

== Oktober 1 ==
10 oktober 1921: Sittard 30,1°C
10 oktober 1921: Gemert 29,0°C
4 oktober 1983: Echt 28,6°C
4 oktober 1983: Venlo 28,1°C
2 oktober 1908: Breda 27,8°C
10 oktober 1979: Venlo 27,3°C

== Oktober 2 ==
12 oktober 1990: Oost-Maarland 25,8°C
19 oktober 1921: Winterswijk 24,2°C

== Oktober 3 ==
27 oktober 1937: Winterswijk 24,0°C
24 oktober 1971: Epen 24,3°C
22 oktober 1989: Venlo 24,3°C
21 oktober 1967: Buchten 23,5°C

== November 1 ==
4 november 1994: Oost-Maarland 21,1°C
7 november 1955: Buchten 21,0°C
5 november 1994: Oost-Maarland 20,9°C
1 november 1943: Sittard 20,7°C
5 november 1963: Buchten 20,5
1 november 1968: Epen 20,4
8 november 1983: Maastricht Caberg 20,4
5 november 1899: Winterswijk 20,2°C
2 november 1935: Sittard 20,0°C
10 november 1977: Epen 18,7°C

== November 2 ==
12 november 1926: Sittard 20,0°C
11 november 1995: Oost-Maarland 19,8°C
13 november 1897: Winterswijk 19,7°C
14 november 1897: Winterswijk 18,5°C

== November 3 ==
28 november 1953: Epen 17,3°C
29 november 1979: Epen 17,3°C
26 november 1970: Epen 16,5°C

== December 1 ==
4 december 1953: Buchten 17,8°C
7 december 1914: Sittard 17,4°C
3 december 1954: St Jansteen 16,0°C
7 december 1979: Epen 15,7°C
2 december 1985: Oost-Maarland 14,9°C

== December 2 ==
16 december 1989: Oost-Maarland 17,4°C
11 december 1978: Epen 16,1°C
20 december 1932: Sittard 15,9°C
18 december 1987: Oost-Maarland 15,7°C
13 december 1998: Oost-Maarland 14,8°C
"""

# ─────────────────────────────────────────────────────────────────────────────
# Koude-records — formaat: "27-1-1942: Station -27,4°C"
# Bron: KNMI-overzicht minimumrecords Nederland per decade
# ─────────────────────────────────────────────────────────────────────────────
COLD_RAW = """
== Januari 1 ==
4-1-1979: Ten Post -24,7°C
5-1-1979: Emmeloord -24,4°C en Ten Post -23,7°C
8-1-1985: Deelen -24,2°C
2-1-1979: Dedemsvaart -24,0°C, Ten Post -23,3°C en Ternaard -22,8°C
3-1-1979: Ten Post -22,1°C
7-1-1985: Deelen -21,3°C
9-1-1968: Eelde -21,1°C
1-1-1971: Eelde -21,0°C
6-1-2009: Ell -20,8°C

== Januari 2 ==
13-1-1968: Dedemsvaart -24,0°C, Eindhoven -21,7°C en Twenthe -21,0°C
18-1-1963: Joure -20,8°C en Soesterberg -20,3°C
12-1-1968: Eelde -20,2°C

== Januari 3 ==
27-1-1942: Winterswijk -27,4°C, Warnsveld -25,4°C en De Bilt -24,8°C
26-1-1942: De Bilt -23,4°C
22-1-1940: Winterswijk -19,6°C
21-1-1942: Winterswijk -18,3°C
29-1-1945: Winterswijk -16,5°C
30-1-1895: Winterswijk -16,1°C

== Februari 1 ==
4-2-2012: Lelystad -22,9°C, Marknesse -22,8°C
7-2-1895: Winterswijk -22,0°C
3-2-1917: Sittard -21,0°C
9-2-1996: Twenthe -21,0°C
3-2-2012: Lelystad -20,9°C
8-2-1942: Winterswijk -20,2°C
3-2-1912: De Bilt -20,1°C
10-2-1895: Winterswijk -19,6°C

== Februari 2 ==
16-2-1956: Uithuizermeeden -26,8°C, Volkel -25,2°C, Winterswijk -24,5°C en Urk -24,0°C
13-2-1940: Winterswijk -24,1°C en Wijster -21,2°C
15-2-1956: Deelen -23,2°C
14-2-1929: Winterswijk -21,5°C, Sittard en Maastricht -21,4°C en Gemert -20,7°C
17-2-1956: Soesterberg -21,3°C
11-2-1929: Eelde -20,0°C
12-2-1895: Winterswijk -19,0°C

== Februari 3 ==
23-2-1986: Joure -21,5°C
23-2-1956: Lelystad -20,7°C, Deelen -20,6°C en Soesterberg -20,5°C
21-2-1986: Oost-Maarland -17,9°C
22-2-1986: Oost-Maarland -17,6°C

== Maart 1 ==
4-3-2005: Marknesse -20,7°C, Hoogeveen -19,7°C
3-3-2005: Marknesse -19,5°C
7-3-1971: Wageningen -18,7°C
10-3-1931: Warnsveld -17,8°C
5-3-1971: Deelen -17,0°C
1-3-1929: Winterswijk -14,5°C

== Maart 2 ==
13-3-2013: Ell -13,3°C
11-3-1958: Rotterdam -12,6°C
12-3-1932: Wijster -11,7°C

== Maart 3 ==
24-3-1899: Winterswijk -14,0°C en De Bilt -11,8°C
26-3-1901: Winterswijk -10,0°C
21-3-1899: Winterswijk -9,3°C
27-3-1931: Eelde -9,1°C
29-3-2013: Herwijnen -8,1°C
23-3-1958: Twenthe -8,0°C
25-3-1899: Winterswijk -7,0°C
25-3-1917: Winterswijk -6,5°C

== April 1 ==
1-4-1996: Twenthe -8,8°C en Soesterberg -8,4°C
2-4-1996: Twenthe -8,7°C
8-4-1905: Winterswijk -8,1°C
4-4-1929: Wijster -7,9°C
8-4-2003: Twenthe -7,9°C
8-4-1968: Twenthe -7,4°C
3-4-1900: Winterswijk -7,1°C
10-4-1977: Wageningen -6,9°C
5-4-1911: Winterswijk -6,0°C
6-4-1911: Winterswijk -5,5°C

== April 2 ==
12-4-1986: Deelen -9,4°C, Soesterberg -8,2°C
19-4-1969: Eelde -8,1°C
14-4-2001: Gilze-Rijen -6,8°C
11-4-1986: Deelen -6,4°C
18-4-1921: Avereest -4,6°C

== April 3 ==
21-4-1991: Heino -7,9°C en Twenthe -7,4°C
29-4-1976: Deelen -7,2°C
24-4-1981: Wageningen -6,3°C
22-4-1929: Eelde -5,9°C en Winterswijk -5,5°C
30-4-1971: Wageningen -5,5°C
25-4-1988: Epen -4,9°C

== Mei 1 ==
9-5-1944: Castricum -5,4°C en Winterswijk -2,2°C
1-5-1962: Deelen -4,5°C
8-5-1941: Winterswijk -4,4°C
2-5-1935: Den Helder -4,2°C
3-5-1941: Wijster -4,0°C

== Mei 2 ==
11-5-1928: Wijster -5,0°C en Winterswijk -3,7°C
11-5-1953: Almen -4,6°C
12-5-1941: Winterswijk -3,7°C
16-5-1909: Eelde -3,7°C
14-5-2020: Eelde -3,0°C
15-5-2020: Eelde -2,9°C
19-5-1907: Winterswijk -2,0°C, Eelde -1,1°C en Avereest -0,5°C

== Mei 3 ==
24-5-1905: Breda -2,5°C en Winterswijk -2,0°C
21-5-1988: Terschelling -2,5°C en Wageningen -1,3°C
30-5-1974: Haamstede -2,2°C
23-5-1980: Dedemsvaart -1,5°C
21-5-1961: Twenthe -1,3°C
22-5-1988: Epen -1,0°C
27-5-1990: Epen -0,8°C

== Juni 1 ==
2-6-1975: Almen -1,2°C
6-6-1924: Winterswijk -1,0°C
2-6-1962: Deelen -0,9°C
3-6-1975: Terschelling -0,6°C
1-6-1975: Deelen -0,4°C
2-6-1991: Hupsel -0,2°C
3-6-1962: Deelen -0,1°C
5-6-1976: Wageningen 0,4°C
5-6-1991: Oost-Maarland 0,4°C
7-6-1909: Winterswijk 2,3°C

== Juni 2 ==
18-6-1955: Witteveen -0,8°C
19-6-1923: Den Helder -0,3°C, Gemert 0,6°C, Warnsveld 0,7°C
13-6-1939: Wijster 0,4°C
20-6-1915: Winterswijk 0,5°C
12-6-1911: Gemert 0,6°C

== Juni 3 ==
24-6-1957: Witteveen 1,3°C
30-6-2000: Deelen 2,2°C
22-6-2010: Eelde 2,5°C
21-6-1915: Den Helder 2,6°C

== Juli 1 ==
3-7-1949: Witteveen 2,1°C
1-7-1971: Deelen 2,1°C
1-7-1984: Deelen 2,2°C
1-7-1906: Eelde 2,5°C

== Juli 2 ==
19-7-1971: Dedemsvaart 0,7°C
18-7-1971: Deelen 2,0°C
12-7-1986: Deelen 2,7°C

== Juli 3 ==
26-7-1929: Wijster 1,6°C
28-7-1929: Warnsveld 2,2°C en Winterswijk 3,0°C
24-7-1990: Epen 3,3°C en Arcen 3,9°C
29-7-1962: Soesterberg 3,9°C
22-7-2012: Twenthe 3,9°C
21-7-1898: Winterswijk 4,0°C
30-7-1962: Winterswijk 4,6°C

== Augustus 1 ==
3-8-1928: Wijster 2,2°C
9-8-1913: Eelde 3,3°C
6-8-1967: Deelen 3,3°C
4-8-1935: Winterswijk 4,4°C
5-8-1923: Winterswijk 4,5°C

== Augustus 2 ==
17-8-1971: Haamstede 3,0°C
20-8-1929: Winterswijk 3,2°C
14-8-1931: Winterswijk 3,7°C
11-8-1904: Winterswijk 3,8°C

== Augustus 3 ==
22-8-1973: Dedemsvaart en Twenthe 1,3°C
21-8-1904: Winterswijk 2,2°C
25-8-1980: Deelen 2,4°C

== September 1 ==
10-9-1986: Deelen 0,3°C
9-9-1986: Deelen 0,7°C
4-9-1930: Winterswijk 2,6°C

== September 2 ==
20-9-1965: Twenthe -3,5°C
16-9-1971: Winterswijk -2,4°C en Soesterberg -2,2°C
20-9-1904: Winterswijk -1,2°C
15-9-1971: Deelen -0,1°C
13-9-1964: Wageningen 0,2°C
14-9-1925: Winterswijk 0,5°C

== September 3 ==
30-9-1928: Wijster -2,6°C
28-9-1939: Winterswijk -2,5°C, Wijster -1,5°C en Gemert -1,2°C
29-9-1921: Gemert -1,9°C, Warnsveld -1,8°C en Winterswijk -1,5°C
24-9-1931: Winterswijk -1,5°C
25-9-1906: Winterswijk -1,2°C
26-9-1906: Winterswijk -0,8°C
21-9-1928: Gemert -0,2°C
22-9-1932: Warnsveld -0,3°C
23-9-1907: Winterswijk -1,0°C
23-9-1928: Winterswijk -1,0°C

== Oktober 1 ==
7-10-1912: Winterswijk -5,7°C en De Bilt -3,2°C
10-10-1904: Winterswijk -3,0°C
5-10-1972: Epen -3,0°C
8-10-2002: Eelde -3,0°C
3-10-1936: Winterswijk -2,9°C
6-10-1936: Winterswijk -2,8°C
9-10-1925: Winterswijk -2,5°C
1-10-1916: Winterswijk -0,5°C

== Oktober 2 ==
19-10-1972: Echt -6,3°C
15-10-1904: Winterswijk -6,2°C
15-10-1971: Wageningen -5,2°C
12-10-1912: Winterswijk -3,7°C
11-10-1936: Winterswijk -3,3°C

== Oktober 3 ==
28-10-1931: Winterswijk -8,5°C, Gemert -8,4°C, Wijster -8,3°C en Warnsveld -8,2°C
24-10-2003: Twenthe -8,5°C
26-10-1922: Slijk-Ewijk -7,9°C
29-10-1922: Eelde -7,7°C
28-10-1997: Twenthe -7,5°C
27-10-1950: Buchten -6,8°C

== November 1 ==
10-11-1908: Sittard -10,1°C
5-11-1995: Twenthe -9,2°C
8-11-1908: Eelde en Winterswijk -8,7°C
10-11-1921: Den Helder -7,8°C
4-11-1980: Almen en Gilze-Rijen -7,7°C
7-11-1908: Winterswijk -7,6°C
9-11-1908: Winterswijk -7,6°C

== November 2 ==
16-11-1965: Eelde -13,3°C
17-11-1919: Avereest -11,5°C en Winterswijk -11,4°C
15-11-1965: Soesterberg -10,3°C
20-11-1971: Dedemsvaart -10,0°C
12-11-1971: Epen -7,5°C
11-11-1971: Joure -7,4°C

== November 3 ==
30-11-1973: Ten Post -16,7°C en Leeuwarden -14,2°C
29-11-1921: De Bilt -14,4°C
30-11-1921: De Bilt -14,4°C, Warnsveld -13,9°C en Akkrum -13,4°C
28-11-1915: Avereest -13,9°C
22-11-1965: Eelde -13,1°C
27-11-1915: Den Helder -13,0°C
26-11-1897: Winterswijk -10,1°C
21-11-1902: Winterswijk -9,8°C

== December 1 ==
2-12-1973: Wageningen -21,7°C en Volkel -18,8°C
4-12-1925: Eelde -18,2°C en Akkrum -16,7°C
5-12-1925: Sittard -18,0°C, Eelde -17,0°C en Winterswijk -16,2°C
5-12-1921: Warnsveld en De Bilt -15,9°C
6-12-1925: Maastricht -15,1°C
1-12-1973: Echt -14,2°C
9-12-1933: Winterswijk -13,9°C
7-12-1902: Winterswijk -13,6°C

== December 2 ==
16-12-1981: Leeuwarden -19,2°C
17-12-1981: Leeuwarden -19,1°C
19-12-2009: Deelen -18,4°C
13-12-1899: Assen -17,0°C en Winterswijk -14,6°C
15-12-1963: Epen -16,5°C
15-12-1899: Winterswijk -16,0°C
14-12-1933: 's-Heerenberg -15,1°C, Winterswijk -14,9°C, Wijster -14,2°C en Akkrum -13,6°C
11-12-1967: Emmen -14,8°C
18-12-1927: Winterswijk -14,5°C

== December 3 ==
31-12-1923: Eelde -22,6°C, Avereest -22,3°C en Winterswijk -21,5°C
23-12-1938: Maastricht -18,2°C en Winterswijk -17,8°C
21-12-1946: Castricum -18,0°C
29-12-1908: Winterswijk -15,7°C
26-12-1938: Winterswijk -15,2°C
26-12-1962: Haamstede -14,5°C
"""

# ─────────────────────────────────────────────────────────────────────────────
# Neerslag-MAANDrecords — droogste maand per kalendermaand (maand-som, niet dag).
# Formaat: "<maand> <jaar>: <Station> <mm> mm"  bijv. "januari 1997: Eersel 1,0 mm"
# Komt in maand-ranglijst (rh_laag) terecht; label = "YYYY-MM" → front-end toont
# "januari 1997". Bewust GEEN dag/decade/seizoen/alltime (zou maand-som als dag
# misrepresenteren). Alleen claims die we hard kunnen onderbouwen.
# ─────────────────────────────────────────────────────────────────────────────
DROOG_RAW = """
== Januari ==
januari 1997: Eersel 1,0 mm
"""

MAAND = {
    "januari": 1, "februari": 2, "maart": 3, "april": 4, "mei": 5, "juni": 6,
    "juli": 7, "augustus": 8, "september": 9, "oktober": 10, "november": 11, "december": 12,
}

# Stations met "en" in eigen naam — niet splitsen op " en " (nu geen)
ATOMIC = set()

LINE_RE_WARM = re.compile(
    r"^(\d{1,2})\s+([a-z]+)\s+(\d{4}):\s*(.+?)\s*$",
    re.IGNORECASE,
)
LINE_RE_COLD = re.compile(
    r"^(\d{1,2})-(\d{1,2})-(\d{4}):\s*(.+?)\s*$",
)

# Pattern: stations (may contain "en", "St.", "'s", "Caberg", "Slijk-Ewijk", "Ohé" enz.)
# gevolgd door temp. Temp kan negatief zijn: "-24,7" of "0,4" of "16,4".
# Char class: alles behalve cijfers, komma's, newlines — laat diacritics (é, ë) en
# dashes door, terwijl temp-grens duidelijk blijft (whitespace dan optioneel '-' dan cijfer).
TEMP_RE = re.compile(
    r"([A-Z’'][^\d,\n]*?)\s+(-?\d{1,2}),(\d)(?:°C)?",
)

# Stations met spellingsvarianten — eerste variant is canoniek
ALIAS = {
    "'s Heerenberg": "'s-Heerenberg",
    "St Jansteen": "St. Jansteen",
}

# Neerslag-maandregel: "<maandnaam> <jaar>: <rest>"
LINE_RE_DROOG = re.compile(r"^([a-z]+)\s+(\d{4}):\s*(.+?)\s*$", re.IGNORECASE)
# Station + maand-som in mm: "Eersel 1,0 mm"
MM_RE = re.compile(r"([A-Z’'][^\d,\n]*?)\s+(\d{1,3}),(\d)\s*mm", re.IGNORECASE)


def decade(day: int) -> str:
    if day <= 10:
        return "1"
    if day <= 20:
        return "2"
    return "3"


def split_stations(blob: str) -> list[str]:
    blob = blob.strip().rstrip(",").strip()
    placeholders = {}
    for i, name in enumerate(ATOMIC):
        ph = f"__ATOMIC{i}__"
        if name in blob:
            blob = blob.replace(name, ph)
            placeholders[ph] = name
    parts = [p.strip() for p in re.split(r"\s+en\s+", blob)]
    parts = [placeholders.get(p, p) for p in parts]
    # Canonicaliseer aliassen
    parts = [ALIAS.get(p, p) for p in parts]
    return [p for p in parts if p]


def parse_warm(raw: str) -> list[tuple[str, str, str, float, str]]:
    """(maand_key, decade_key, iso_date, temp, station)"""
    out = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("=="):
            continue
        m = LINE_RE_WARM.match(line)
        if not m:
            print(f"WARM SKIP regex: {line!r}")
            continue
        day_s, maand_s, year_s, rest = m.groups()
        day = int(day_s)
        year = int(year_s)
        maand = MAAND.get(maand_s.lower())
        if not maand:
            print(f"WARM SKIP maand: {line!r}")
            continue
        iso = f"{year:04d}-{maand:02d}-{day:02d}"
        matches = TEMP_RE.findall(rest)
        if not matches:
            print(f"WARM SKIP geen temp: {line!r}")
            continue
        seen = set()
        for stns_blob, whole, frac in matches:
            temp = float(f"{whole}.{frac}")
            for stn in split_stations(stns_blob):
                stn = " ".join(stn.split())
                if not stn:
                    continue
                key = (stn, iso, temp)
                if key in seen:
                    continue
                seen.add(key)
                out.append((str(maand), decade(day), iso, temp, stn))
    return out


def parse_cold(raw: str) -> list[tuple[str, str, str, float, str]]:
    """(maand_key, decade_key, iso_date, temp, station)"""
    out = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("=="):
            continue
        m = LINE_RE_COLD.match(line)
        if not m:
            print(f"COLD SKIP regex: {line!r}")
            continue
        day_s, maand_s, year_s, rest = m.groups()
        day = int(day_s)
        maand = int(maand_s)
        year = int(year_s)
        if not (1 <= maand <= 12):
            print(f"COLD SKIP maand: {line!r}")
            continue
        iso = f"{year:04d}-{maand:02d}-{day:02d}"
        matches = TEMP_RE.findall(rest)
        if not matches:
            print(f"COLD SKIP geen temp: {line!r}")
            continue
        seen = set()
        for stns_blob, whole, frac in matches:
            temp = float(f"{whole}.{frac}")
            for stn in split_stations(stns_blob):
                stn = " ".join(stn.split())
                if not stn:
                    continue
                key = (stn, iso, temp)
                if key in seen:
                    continue
                seen.add(key)
                out.append((str(maand), decade(day), iso, temp, stn))
    return out


def parse_droog(raw: str) -> list[tuple[str, str, float, str]]:
    """Neerslag-maandrecords → (maand_key, "YYYY-MM", mm, station)."""
    out = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("=="):
            continue
        m = LINE_RE_DROOG.match(line)
        if not m:
            print(f"DROOG SKIP regex: {line!r}")
            continue
        maand_s, year_s, rest = m.groups()
        maand = MAAND.get(maand_s.lower())
        if not maand:
            print(f"DROOG SKIP maand: {line!r}")
            continue
        ym = f"{int(year_s):04d}-{maand:02d}"
        matches = MM_RE.findall(rest)
        if not matches:
            print(f"DROOG SKIP geen mm: {line!r}")
            continue
        seen = set()
        for stns_blob, whole, frac in matches:
            mm = float(f"{whole}.{frac}")
            for stn in split_stations(stns_blob):
                stn = " ".join(stn.split())
                if not stn:
                    continue
                key = (stn, ym, mm)
                if key in seen:
                    continue
                seen.add(key)
                out.append((str(maand), ym, mm, stn))
    return out


def aggregate_maand(parsed, sleutel: str, ascending: bool) -> dict:
    """Maand-records (geen dag/decade): maand_key → sleutel → top-25 [waarde, "YYYY-MM", station]."""
    sort_key = (lambda x: x[0]) if ascending else (lambda x: -x[0])
    maand_map: dict[str, dict[str, list]] = {}
    for maand_key, ym, waarde, stn in parsed:
        m = maand_map.setdefault(maand_key, {})
        lst = m.setdefault(sleutel, [])
        lst.append([waarde, ym, stn])
    for m in maand_map.values():
        for lst in m.values():
            lst.sort(key=sort_key)
            del lst[25:]
    return maand_map


SEIZOEN = {
    12: "winter", 1: "winter", 2: "winter",
    3: "lente",  4: "lente",  5: "lente",
    6: "zomer",  7: "zomer",  8: "zomer",
    9: "herfst", 10: "herfst", 11: "herfst",
}


def aggregate(parsed, sleutel: str, ascending: bool) -> tuple[dict, dict, dict, dict, list]:
    """Geeft (decade_map, maand_map, dag_map, seizoen_map, alltime_lijst). top-25 per groep."""
    sort_key = (lambda x: (x[0], x[1])) if ascending else (lambda x: (-x[0], x[1]))

    decade_map: dict[str, dict[str, dict[str, list]]] = {}
    for maand_key, dec_key, iso, temp, stn in parsed:
        m = decade_map.setdefault(maand_key, {})
        d = m.setdefault(dec_key, {})
        lst = d.setdefault(sleutel, [])
        lst.append([temp, iso, stn])
    for m in decade_map.values():
        for d in m.values():
            for lst in d.values():
                lst.sort(key=sort_key)
                del lst[25:]

    maand_map: dict[str, dict[str, list]] = {}
    for maand_key, _, iso, temp, stn in parsed:
        m = maand_map.setdefault(maand_key, {})
        lst = m.setdefault(sleutel, [])
        lst.append([temp, iso, stn])
    for m in maand_map.values():
        for lst in m.values():
            lst.sort(key=sort_key)
            del lst[25:]

    # dag-map: maand → dag → sleutel → lijst (top-25)
    dag_map: dict[str, dict[str, dict[str, list]]] = {}
    for maand_key, _, iso, temp, stn in parsed:
        dag_nr = str(int(iso.split("-")[2]))
        m = dag_map.setdefault(maand_key, {})
        d = m.setdefault(dag_nr, {})
        lst = d.setdefault(sleutel, [])
        lst.append([temp, iso, stn])
    for m in dag_map.values():
        for d in m.values():
            for lst in d.values():
                lst.sort(key=sort_key)
                del lst[25:]

    # seizoen-map: winter/lente/zomer/herfst → sleutel → lijst (top-25)
    seizoen_map: dict[str, dict[str, list]] = {}
    for maand_key, _, iso, temp, stn in parsed:
        s = SEIZOEN[int(maand_key)]
        sez = seizoen_map.setdefault(s, {})
        lst = sez.setdefault(sleutel, [])
        lst.append([temp, iso, stn])
    for sez in seizoen_map.values():
        for lst in sez.values():
            lst.sort(key=sort_key)
            del lst[25:]

    alle = [(temp, iso, stn) for (_, _, iso, temp, stn) in parsed]
    alle.sort(key=sort_key)
    alltime_lijst = [[t, d, s] for (t, d, s) in alle[:25]]

    return decade_map, maand_map, dag_map, seizoen_map, alltime_lijst


def merge_maps(target: dict, source: dict):
    """Voegt source-map (per maand[/decade]) in target — copy-deep per key."""
    for maand_key, source_inner in source.items():
        tgt_inner = target.setdefault(maand_key, {})
        if isinstance(source_inner, dict) and source_inner and isinstance(next(iter(source_inner.values())), dict):
            # Nested decade structure
            for dec_key, dec_data in source_inner.items():
                tgt_dec = tgt_inner.setdefault(dec_key, {})
                for sleutel, lst in dec_data.items():
                    tgt_dec[sleutel] = lst
        else:
            for sleutel, lst in source_inner.items():
                tgt_inner[sleutel] = lst


def build() -> dict:
    warm = parse_warm(WARM_RAW)
    cold = parse_cold(COLD_RAW)

    warm_dec, warm_maand, warm_dag, warm_seizoen, warm_all = aggregate(warm, "tx_hoog", ascending=False)
    cold_dec, cold_maand, cold_dag, cold_seizoen, cold_all = aggregate(cold, "tn_laag", ascending=True)

    decade_map: dict = {}
    merge_maps(decade_map, warm_dec)
    merge_maps(decade_map, cold_dec)

    # Neerslag-maandrecords (droogste maand) — alleen in maand-ranglijst
    droog = parse_droog(DROOG_RAW)
    droog_maand = aggregate_maand(droog, "rh_laag", ascending=True)

    maand_map: dict = {}
    merge_maps(maand_map, warm_maand)
    merge_maps(maand_map, cold_maand)
    merge_maps(maand_map, droog_maand)

    dag_map: dict = {}
    merge_maps(dag_map, warm_dag)
    merge_maps(dag_map, cold_dag)

    seizoen_map: dict = {}
    merge_maps(seizoen_map, warm_seizoen)
    merge_maps(seizoen_map, cold_seizoen)

    nu = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return {
        "station": "Historische extremen NL",
        "station_nr": "nl_extreme",
        "van": "1894-01-01",
        "tm": "2020-12-31",
        "gegenereerd": nu,
        "bron": "Gecureerde historische warmte- en koude-records Nederlandse stations (incl. opgeheven stations)",
        "dag": dag_map,
        "decade": decade_map,
        "maand": maand_map,
        "seizoen": seizoen_map,
        "jaar": {},
        "alltime": {
            "tx_hoog": warm_all,
            "tn_laag": cold_all,
        },
    }


if __name__ == "__main__":
    data = build()
    out_path = "/Users/aldus/KNMI_Project/weerlab/records_nl_extreme.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Geschreven: {out_path}")
    n_warm = sum(len(d.get("tx_hoog", [])) for m in data["decade"].values() for d in m.values())
    n_cold = sum(len(d.get("tn_laag", [])) for m in data["decade"].values() for d in m.values())
    print(f"Warm decade-entries: {n_warm}")
    print(f"Cold decade-entries: {n_cold}")
    print(f"Alltime warm top: {len(data['alltime']['tx_hoog'])}")
    print(f"Alltime cold top: {len(data['alltime']['tn_laag'])}")
