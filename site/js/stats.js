/* Pure statistical helpers for the experiment lab.
 *
 * No DOM, no side effects. The module attaches itself to window.Stats in the
 * browser and to module.exports under CommonJS so it can be tested with Node.
 */
(function (global) {
  "use strict";

  var SQRT_2PI = Math.sqrt(2 * Math.PI);

  /* Error function as a Taylor series, used for |x| < 1 where it converges
   * quickly with no meaningful cancellation. */
  function erfSeries(x) {
    var x2 = x * x;
    var term = x; /* n! denominator folded into the recurrence below */
    var sum = x;
    var n = 0;
    while (true) {
      n += 1;
      term *= -x2 / n;
      var add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) <= 1e-18 * Math.abs(sum) || n > 200) {
        break;
      }
    }
    return (2 / Math.sqrt(Math.PI)) * sum;
  }

  /* Complementary error function. Uses the Taylor series near zero and the
   * A&S 7.1.14 continued fraction for |x| >= 1, evaluated with the modified
   * Lentz algorithm. Accurate to close to double precision. */
  function erfc(x) {
    if (x < 0) {
      return 2 - erfc(-x);
    }
    if (x < 1) {
      return 1 - erfSeries(x);
    }
    var tiny = 1e-300;
    var f = x;
    var C = f;
    var D = 0;
    var n;
    for (n = 1; n <= 400; n += 1) {
      var a = n / 2;
      D = x + a * D;
      if (D === 0) {
        D = tiny;
      }
      C = x + a / C;
      if (C === 0) {
        C = tiny;
      }
      D = 1 / D;
      var delta = C * D;
      f *= delta;
      if (Math.abs(delta - 1) <= 1e-17) {
        break;
      }
    }
    return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
  }

  /* Standard normal cumulative distribution function. */
  function normCdf(x) {
    return 0.5 * erfc(-x / Math.SQRT2);
  }

  /* Standard normal quantile function. Acklam's algorithm refined by one
   * Newton step, accurate to roughly 1e-12 in the central range. */
  function normInv(p) {
    if (!(p > 0 && p < 1)) {
      if (p <= 0) {
        return -Infinity;
      }
      if (p >= 1) {
        return Infinity;
      }
      return NaN;
    }

    var a = [
      -3.969683028665376e1,
      2.209460984245205e2,
      -2.759285104469687e2,
      1.38357751867269e2,
      -3.066479806614716e1,
      2.506628277459239
    ];
    var b = [
      -5.447609879822406e1,
      1.615858368580409e2,
      -1.556989798598866e2,
      6.680131188771972e1,
      -1.328068155288572e1
    ];
    var c = [
      -7.784894002430293e-3,
      -3.223964580411365e-1,
      -2.400758277161838,
      -2.549732539343734,
      4.374664141464968,
      2.938163982698783
    ];
    var d = [
      7.784695709041462e-3,
      3.224671290700398e-1,
      2.445134137142996,
      3.754408661907416
    ];

    var pLow = 0.02425;
    var pHigh = 1 - pLow;
    var q;
    var r;
    var x;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      x =
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      x =
        (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x =
        -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }

    /* One Newton/Halley refinement against the CDF and PDF. */
    var e = normCdf(x) - p;
    var u = e * SQRT_2PI * Math.exp((x * x) / 2);
    x = x - u / (1 + (x * u) / 2);
    return x;
  }

  /* Users required per arm to detect a relative lift on a baseline rate. */
  function sampleSizePerArm(pBase, relLift, alpha, power) {
    alpha = alpha === undefined ? 0.05 : alpha;
    power = power === undefined ? 0.8 : power;
    if (!(pBase > 0 && pBase < 1)) {
      throw new RangeError("pBase must be strictly between 0 and 1");
    }
    if (!(relLift > 0)) {
      throw new RangeError("relLift must be positive");
    }
    var p1 = pBase;
    var p2 = p1 * (1 + relLift);
    if (p2 >= 1) {
      throw new RangeError("pBase * (1 + relLift) must stay below 1");
    }
    var pbar = 0.5 * (p1 + p2);
    var zAlpha = normInv(1 - alpha / 2);
    var zPower = normInv(power);
    var numerator =
      Math.pow(
        zAlpha * Math.sqrt(2 * pbar * (1 - pbar)) +
          zPower * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)),
        2
      );
    var denominator = Math.pow(p2 - p1, 2);
    return Math.ceil(numerator / denominator);
  }

  /* Two-sided two-proportion z-test with a pooled standard error. */
  function twoProportionZ(xC, nC, xT, nT) {
    if (!(nC > 0) || !(nT > 0)) {
      return { diff: NaN, z: NaN, pValue: NaN };
    }
    var pC = xC / nC;
    var pT = xT / nT;
    var diff = pT - pC;
    var pooled = (xC + xT) / (nC + nT);
    var se = Math.sqrt(pooled * (1 - pooled) * (1 / nC + 1 / nT));
    var z;
    var pValue;
    if (se > 0) {
      z = diff / se;
      pValue = 2 * normCdf(-Math.abs(z));
    } else {
      z = diff === 0 ? 0 : (diff > 0 ? Infinity : -Infinity);
      pValue = diff === 0 ? 1 : 0;
    }
    return { diff: diff, z: z, pValue: pValue };
  }

  /* Wilson score interval for a binomial proportion at 95% by default. */
  function wilson(k, n, alpha) {
    alpha = alpha === undefined ? 0.05 : alpha;
    if (!(n > 0)) {
      return [NaN, NaN];
    }
    var z = normInv(1 - alpha / 2);
    var p = k / n;
    var denom = 1 + (z * z) / n;
    var centre = (p + (z * z) / (2 * n)) / denom;
    var half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
    return [centre - half, centre + half];
  }

  /* Small, fast, seedable 32-bit PRNG. Returns a function in [0, 1). */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var api = {
    normCdf: normCdf,
    normInv: normInv,
    sampleSizePerArm: sampleSizePerArm,
    twoProportionZ: twoProportionZ,
    wilson: wilson,
    mulberry32: mulberry32
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.Stats = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
