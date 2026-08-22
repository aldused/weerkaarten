/* WBGT / Hittekracht volgens de Weerlab-berekeningshandleiding.
 *
 * Kernformule buiten met zon (ISO 7243):
 *   WBGT = 0,7*Tnw + 0,2*Tg + 0,1*Ta
 *
 * Tnw: natuurlijke natteboltemperatuur via Liljegren (2008) warmte/massabalans
 *       op natte kokersilinder (d=7mm), opgelost met Newton-Raphson.
 *       Initiaal geschat via Stull (2011); Tnw >= Tw bij lage windsnelheid.
 * Tg:  boltemperatuur via Liljegren/Kong-Huber warmtebalans op 50,8mm bol.
 *
 * De bestaande pagina-API blijft: wbgtOutdoor() ontvangt wind op 10 m in m/s.
 * Conform KNMI TR-26-04 wordt u10 begrensd op minimaal 0,62 m/s en daarna
 * stabiliteitsafhankelijk omgerekend naar 2 m wind voor de WBGT-berekening.
 *
 * Window namespace: window.WBGT
 */
(function (root) {
  "use strict";

  var SIGMA      = 5.6696e-8;
  var SOLAR_SCALE = 800.0;

  /* Kong & Huber / Liljegren constanten */
  var MAIR = 28.97;
  var MH2O = 18.015;
  var RGAS = 8314.34;
  var CP = 1003.5;
  var RATIO = CP * MAIR / MH2O;
  var RAIR = RGAS / MAIR;
  var PR = CP / (CP + 1.25 * RAIR);
  var DIAM_GLOBE = 0.0508;
  var EMIS_GLOBE = 0.95;
  var ALB_GLOBE = 0.05;
  var EMIS_WICK = 0.95;
  var ALB_WICK = 0.4;
  var DIAM_WICK = 0.007;
  var LEN_WICK = 0.0254;
  var ALB_SFC = 0.45;
  var MIN_WIND_10M = 0.62;
  var LS_RDT = [
    [1, 1, 2, 4, 0, 5, 6, 0],
    [1, 2, 3, 4, 0, 5, 6, 0],
    [2, 2, 3, 4, 0, 4, 4, 0],
    [3, 3, 4, 4, 0, 0, 0, 0],
    [3, 4, 4, 4, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ];
  var URBAN_EXP = [0.15, 0.15, 0.20, 0.25, 0.30, 0.30];

  function finite(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function saturationFactor(T) {
    return Math.exp(17.625 * T / (243.04 + T));
  }

  function buckEs(T) {
    return 6.1094 * saturationFactor(T);
  }

  function rhFromTd(Ta, Td) {
    if (!finite(Ta) || !finite(Td)) return null;
    return clamp(100 * saturationFactor(Td) / saturationFactor(Ta), 0, 100);
  }

  function vaporPressure(Ta, RH) {
    if (!finite(Ta) || !finite(RH)) return null;
    return clamp(RH, 0, 100) / 100 * buckEs(Ta);
  }

  function stullTw(Ta, RH) {
    if (!finite(Ta) || !finite(RH)) return null;
    var rh = clamp(RH, 0, 100);
    return Ta * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
         + Math.atan(Ta + rh)
         - Math.atan(rh - 1.676331)
         + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh)
         - 4.686035;
  }

  function pressurePa(pressure) {
    if (!finite(pressure)) return 101325;
    return pressure < 2000 ? pressure * 100 : pressure;
  }

  function toKelvin(Ta) {
    return Ta > 170 ? Ta : Ta + 273.15;
  }

  function viscosity(Tk) {
    var omega = 1.2945 - Tk / 1141.176470588;
    return 0.0000026693 * Math.sqrt(28.97 * Tk) / (13.082689 * omega);
  }

  function thermcond(Tk) {
    return (CP + 1.25 * RAIR) * viscosity(Tk);
  }

  function esatK(Tk, psPa) {
    var es;
    if (Tk > 273.15) {
      es = 611.21 * Math.exp(17.502 * (Tk - 273.15) / (Tk - 32.18));
      return (1.0007 + 3.46e-6 * psPa / 100) * es;
    }
    es = 611.15 * Math.exp(22.452 * (Tk - 273.15) / (Tk - 0.6));
    return (1.0003 + 4.18e-6 * psPa / 100) * es;
  }

  function emisAtm(Tk, RH, psPa) {
    var e = clamp(RH, 0, 100) * 0.01 * (esatK(Tk, psPa) * 0.01);
    return 0.575 * Math.pow(Math.max(e, 0), 0.143);
  }

  function diffusivity(Tk, psPa) {
    return 2.471773765165648e-5 * Math.pow(Tk * 0.0034210563748421257, 2.334) * Math.pow(psPa / 101325, -1);
  }

  function hEvap(Tk) {
    return 1665134.5 + 2370.0 * Tk;
  }

  function stabSrdt(cosZ, u10, rsds) {
    var i, j;
    if (cosZ > 0) {
      if (rsds >= 925) j = 0;
      else if (rsds >= 675) j = 1;
      else if (rsds >= 175) j = 2;
      else j = 3;
      if (u10 >= 6.0) i = 4;
      else if (u10 >= 5.0) i = 3;
      else if (u10 >= 3.0) i = 2;
      else if (u10 >= 2.0) i = 1;
      else i = 0;
    } else {
      j = 5;
      if (u10 >= 2.5) i = 2;
      else if (u10 >= 2.0) i = 1;
      else i = 0;
    }
    return LS_RDT[i][j] || 1;
  }

  function wind10mTo2m(u10, cosZ, rsds) {
    if (!finite(u10)) return null;
    var u = Math.max(MIN_WIND_10M, u10);
    var stabilityClass = stabSrdt(finite(cosZ) ? cosZ : 0, u, finite(rsds) ? Math.max(0, rsds) : 0);
    return Math.max(u * Math.pow(2.0 / 10.0, URBAN_EXP[stabilityClass - 1]), 0.13);
  }

  // Backwards compatible alias; older pages used this name for body-height wind.
  function wind10mTo1m(u10, cosZ, rsds) {
    return wind10mTo2m(u10, cosZ, rsds);
  }

  // dt: JS Date object (UTC)
  function solarZenithCos(latDeg, lonDeg, dt) {
    if (!finite(latDeg) || !finite(lonDeg) || !(dt instanceof Date) || isNaN(dt)) return 0;
    var start = Date.UTC(dt.getUTCFullYear(), 0, 0);
    var n = Math.floor((dt.getTime() - start) / 86400000);
    var decl = (23.45 * Math.PI / 180) * Math.sin(2 * Math.PI * (284 + n) / 365);
    var B = 2 * Math.PI * (n - 81) / 364;
    var eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    var utcH = dt.getUTCHours() + dt.getUTCMinutes() / 60 + dt.getUTCSeconds() / 3600;
    var solarH = utcH + lonDeg / 15.0 + eot / 60.0;
    var H = (15.0 * (solarH - 12)) * Math.PI / 180;
    var lat = latDeg * Math.PI / 180;
    var cz = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    return Math.max(0, cz);
  }

  function clearSkyGhi(cosZ) {
    return SOLAR_SCALE * clamp(finite(cosZ) ? cosZ : 0, 0, 1);
  }

  function estimateGhi(cosZ, cloudFraction) {
    var c = clamp(finite(cloudFraction) ? cloudFraction : 0.5, 0, 1);
    return clearSkyGhi(cosZ) * (1 - c);
  }

  function erbsSplit(S, cosZ) {
    var s = Math.max(0, finite(S) ? S : 0);
    var cz = clamp(finite(cosZ) ? cosZ : 0, 0, 1);
    if (s <= 0 || cz <= 0) return { fdb: 0, fdif: 1 };
    var clear = Math.max(1, clearSkyGhi(cz));
    var fdif = clamp(1 - s / clear, 0.165, 1);
    return { fdb: 1 - fdif, fdif: fdif };
  }

  function estimateFdir(rsds, cosZ) {
    var s = Math.max(0, finite(rsds) ? rsds : 0);
    var cz = clamp(finite(cosZ) ? cosZ : 0, 0, 1);
    if (cz <= Math.cos(89.5 * Math.PI / 180) || s <= 0) return 0;
    var sStar = Math.min(s / Math.max(1e-6, 1367 * cz), 0.85);
    if (sStar <= 0) return 0;
    return clamp(Math.exp(3 - 1.34 * sStar - 1.65 / sStar), 0, 0.9);
  }

  function normalizeFdir(fdir, rsds, cosZ) {
    var cz = clamp(finite(cosZ) ? cosZ : 0, 0, 1);
    if (cz <= Math.cos(89.5 * Math.PI / 180) || !finite(rsds) || rsds <= 0) return 0;
    return finite(fdir) ? clamp(fdir, 0, 0.9) : estimateFdir(rsds, cz);
  }

  function hSphereInAir(Tk, psPa, wind2m) {
    var thermcon = thermcond(Tk);
    var density = psPa / (RAIR * Tk);
    var Re = Math.max(0, wind2m) * density * DIAM_GLOBE / viscosity(Tk);
    var Nu = 2 + 0.6 * Math.sqrt(Math.max(0, Re)) * Math.pow(PR, 0.3333);
    return Nu * thermcon / DIAM_GLOBE;
  }

  function hCylinderInAir(Tk, psPa, wind2m) {
    var thermcon = thermcond(Tk);
    var density = psPa / (RAIR * Tk);
    var Re = Math.max(0, wind2m) * density * DIAM_WICK / viscosity(Tk);
    var Nu = 0.281 * Math.pow(Math.max(0, Re), 0.6) * Math.pow(PR, 0.44);
    return Nu * thermcon / DIAM_WICK;
  }

  function solveBracketed(fn, lo, hi, fallback) {
    var flo = fn(lo), fhi = fn(hi), found = finite(flo) && finite(fhi) && flo * fhi <= 0;
    if (!found) {
      var px = lo, pf = flo;
      for (var s = 1; s <= 80; s++) {
        var x = lo + (hi - lo) * s / 80;
        var fx = fn(x);
        if (finite(pf) && finite(fx) && pf * fx <= 0) {
          lo = px; hi = x; flo = pf; fhi = fx; found = true; break;
        }
        px = x; pf = fx;
      }
      if (!found) return fallback;
    }
    for (var i = 0; i < 80; i++) {
      var mid = 0.5 * (lo + hi);
      var fm = fn(mid);
      if (!finite(fm) || Math.abs(hi - lo) < 0.001) return mid;
      if (flo * fm <= 0) {
        hi = mid; fhi = fm;
      } else {
        lo = mid; flo = fm;
      }
    }
    return 0.5 * (lo + hi);
  }

  /* Zwarteboltemperatuur volgens de Liljegren/Kong-Huber warmtebalans.
   * Ta in °C, Sr in W/m², wind2m in m/s, pressure in hPa of Pa. */
  function calcGlobeTemp(Ta, Sr, wind2m, pressure, RH, cosZ, fdir) {
    if (!finite(Ta)) return null;
    var s = Math.max(0, finite(Sr) ? Sr : 0);
    var TaK = toKelvin(Ta);
    var ps = pressurePa(pressure);
    var rh = clamp(finite(RH) ? RH : 50, 0, 100);
    var cz = clamp(finite(cosZ) ? cosZ : 0, 0, 1);
    var fd = normalizeFdir(fdir, s, cz);
    var u2 = Math.max(finite(wind2m) ? wind2m : 0.5, 0.13);
    var directTerm = fd > 0 && cz > 0 ? (0.5 / cz - 1) * fd : 0;
    var C0 = 0.5 * (1 + emisAtm(TaK, rh, ps)) * Math.pow(TaK, 4)
      + s * (1 - ALB_GLOBE) / (2 * EMIS_GLOBE * SIGMA) * (1 + directTerm + ALB_SFC);
    var fn = function (x) {
      var h = hSphereInAir(0.5 * (TaK + x), ps, u2);
      return C0 - h * (x - TaK) / (EMIS_GLOBE * SIGMA) - Math.pow(x, 4);
    };
    return solveBracketed(fn, TaK - 50, TaK + 90, TaK) - 273.15;
  }

  /* Backwards compatible wrapper. */
  function globeTemperature(Ta, RH, S, cosZ, u1m) {
    if (arguments.length <= 3) return calcGlobeTemp(Ta, S, 0.5, null, RH, 0, null);
    return calcGlobeTemp(Ta, S, u1m, null, RH, cosZ, null);
  }

  /* Natuurlijke natteboltemperatuur volgens Liljegren/Kong-Huber. */
  function naturalWetBulbLiljegren(Ta, RH, wind2m, Sr, pressure, fdir, cosZ) {
    if (!finite(Ta) || !finite(RH)) return null;
    var rh = clamp(RH, 0, 100);
    var s = Math.max(0, finite(Sr) ? Sr : 0);
    var TaK = toKelvin(Ta);
    var ps = pressurePa(pressure);
    var cz = clamp(finite(cosZ) ? cosZ : 0, 0, 1);
    var fd = normalizeFdir(fdir, s, cz);
    var u2 = Math.max(finite(wind2m) ? wind2m : 0.5, 0.13);
    var ea = rh * 0.01 * esatK(TaK, ps);
    var directWick = fd > 0 && cz > 0
      ? (Math.tan(Math.acos(cz)) / Math.PI + DIAM_WICK / (4 * LEN_WICK)) * fd
      : 0;
    var diffuseWick = (1 + DIAM_WICK / (4 * LEN_WICK)) * (1 - fd);
    var FatmBase = EMIS_WICK * 0.5 * SIGMA * Math.pow(TaK, 4) * (emisAtm(TaK, rh, ps) + 1)
      + (1 - ALB_WICK) * s * (diffuseWick + directWick + ALB_SFC);
    var fn = function (x) {
      var avgT = 0.5 * (TaK + x);
      var evap = hEvap(avgT);
      var es = esatK(x, ps);
      var density = ps / (avgT * RAIR);
      var Sc = viscosity(avgT) / (density * diffusivity(avgT, ps));
      var h = hCylinderInAir(avgT, ps, u2);
      var Fatm = FatmBase - EMIS_WICK * SIGMA * Math.pow(x, 4);
      return TaK - evap / RATIO * (es - ea) / (ps - es) * Math.pow(PR / Sc, 0.56) + Fatm / h - x;
    };
    var lo = TaK - (100 - rh) / 5.0 - 50;
    var hi = Math.min(TaK + 70, 340);
    return solveBracketed(fn, lo, hi, TaK) - 273.15;
  }

  function naturalWetBulb(Ta, RH, wind2m, pressure) {
    if (arguments.length === 1 || !finite(RH)) return Ta;
    return naturalWetBulbLiljegren(Ta, RH, wind2m, 0, pressure, 0, 0);
  }

  function wbgtRisico(wbgt) {
    if (!finite(wbgt)) return "";
    if (wbgt < 19) return "Laag";
    if (wbgt < 23) return "Matig";
    if (wbgt < 28) return "Hoog";
    if (wbgt < 32) return "Erg hoog";
    return "Extreem";
  }

  function wbgtHittekracht(wbgt) {
    if (!finite(wbgt)) return null;
    return clamp(Math.floor((wbgt - 14.0) / 2.0) + 1, 0, 10);
  }

  function wbgtColor(wbgt) {
    if (!finite(wbgt)) return "#cccccc";
    if (wbgt < 15) return "#4472C4";
    if (wbgt < 19) return "#70AD47";
    if (wbgt < 23) return "#FFD700";
    if (wbgt < 28) return "#FFA500";
    if (wbgt < 32) return "#FF4500";
    return "#8B0000";
  }

  function componentsAt2mWind(Ta, RH, wind2m, Sr, outdoor, pressure, fdir, cosZ, u10) {
    if (!finite(Ta) || !finite(RH)) return null;
    var s = Math.max(0, finite(Sr) ? Sr : 0);
    var v = Math.max(finite(wind2m) ? wind2m : 0.5, 0.13);
    var ps = pressurePa(pressure);
    var cz = clamp(finite(cosZ) ? cosZ : 0, 0, 1);
    var fd = normalizeFdir(fdir, s, cz);
    var Tw  = stullTw(Ta, RH);
    if (!finite(Tw)) return null;
    var useSolar = outdoor !== false ? s : 0;
    var Tnw = naturalWetBulbLiljegren(Ta, RH, v, useSolar, ps, fd, cz);
    var Tg = outdoor !== false ? calcGlobeTemp(Ta, useSolar, v, ps, RH, cz, fd) : Ta;
    var WBGT = 0.7 * Tnw + 0.2 * Tg + 0.1 * Ta;
    return {
      Ta: Ta,
      RH: clamp(RH, 0, 100),
      Tw: Tw,
      Tnw: Tnw,
      Tg: Tg,
      u1m: v,
      u2m: v,
      u10: finite(u10) ? Math.max(MIN_WIND_10M, u10) : null,
      S: useSolar,
      fdir: fd,
      pressurePa: ps,
      cosZ: cz,
      WBGT: WBGT,
      mode: outdoor !== false && useSolar > 0 ? "buiten" : "schaduw/nacht",
      risico: wbgtRisico(WBGT),
      hittekracht: wbgtHittekracht(WBGT)
    };
  }

  function calcWbgt(Ta, RH, wind2m, Sr, outdoor, pressure, fdir, cosZ) {
    var c = componentsAt2mWind(Ta, RH, wind2m, Sr, outdoor, pressure, fdir, cosZ, null);
    if (!c) return null;
    return {
      Tw: round1(c.Tw),
      Tnw: round1(c.Tnw),
      Tg: round1(c.Tg),
      u2m: round1(c.u2m),
      WBGT: round1(c.WBGT),
      mode: c.mode,
      risico: c.risico,
      hittekracht: c.hittekracht
    };
  }

  function wbgtComponents(Ta, RH, S, u10, cosZ, cloudFraction, pressure, fdir) {
    var cz = clamp(finite(cosZ) ? cosZ : 0, 0, 1);
    var cloud = finite(cloudFraction) ? clamp(cloudFraction, 0, 1) : null;
    var solar = finite(S) ? Math.max(0, S) : (cloud == null ? 0 : estimateGhi(cz, cloud));
    var u10eff = finite(u10) ? Math.max(MIN_WIND_10M, u10) : 1.0;
    var u2m = wind10mTo2m(u10eff, cz, solar);
    var c = componentsAt2mWind(Ta, RH, u2m, solar, true, pressure, fdir, cz, u10eff);
    if (!c) return null;
    c.u10Raw = finite(u10) ? Math.max(0, u10) : null;
    c.cosZ = cz;
    c.cloudFraction = cloud;
    return c;
  }

  // u10 in m/s, S in W/m2. Cloud-fractie, druk en directe-stralingsfractie optioneel.
  function wbgtOutdoor(Ta, RH, S, u10, cosZ, cloudFraction, pressure, fdir) {
    var c = wbgtComponents(Ta, RH, S, u10, cosZ, cloudFraction, pressure, fdir);
    return c ? c.WBGT : null;
  }

  // Convenience wrapper. dt: Date (UTC). cloudFraction: 0..1 of null.
  // S optioneel; als S ontbreekt wordt hij volgens de handleiding ruw geschat.
  function wbgtFromTd(Ta, Td, u10ms, lat, lon, dt, cloudFraction, S, pressure, fdir) {
    if (!finite(Ta) || !finite(Td)) return null;
    var cosZ = solarZenithCos(lat, lon, dt);
    var cloud = finite(cloudFraction) ? clamp(cloudFraction, 0, 1) : null;
    var solar = finite(S) ? Math.max(0, S) : (cloud == null ? null : estimateGhi(cosZ, cloud));
    if (solar == null) return null;
    var RH = rhFromTd(Ta, Td);
    var u10 = finite(u10ms) ? u10ms : 1.0;
    return wbgtOutdoor(Ta, RH, solar, u10, cosZ, cloud, pressure, fdir);
  }

  root.WBGT = {
    buckEs: buckEs,
    vaporPressure: vaporPressure,
    rhFromTd: rhFromTd,
    stullTw: stullTw,
    wind10mTo1m: wind10mTo1m,
    wind10mTo2m: wind10mTo2m,
    solarZenithCos: solarZenithCos,
    clearSkyGhi: clearSkyGhi,
    estimateGhi: estimateGhi,
    estimateFdir: estimateFdir,
    normalizeFdir: normalizeFdir,
    pressurePa: pressurePa,
    erbsSplit: erbsSplit,
    calcGlobeTemp: calcGlobeTemp,
    globeTemperature: globeTemperature,
    naturalWetBulb: naturalWetBulb,
    naturalWetBulbLiljegren: naturalWetBulbLiljegren,
    wbgtRisico: wbgtRisico,
    wbgtHittekracht: wbgtHittekracht,
    wbgtColor: wbgtColor,
    calcWbgt: calcWbgt,
    wbgtComponents: wbgtComponents,
    wbgtOutdoor: wbgtOutdoor,
    wbgtFromTd: wbgtFromTd
  };
})(typeof window !== "undefined" ? window : globalThis);
