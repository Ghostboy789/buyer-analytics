/* Experiment lab: sample size, A/A calibration and peeking.
 *
 * All work is client-side. Simulations run in chunks scheduled with
 * setTimeout so the page stays responsive, and the Run button is disabled
 * while a run is in flight.
 */
(function () {
  "use strict";

  var S = window.Stats;
  var C = window.Charts;

  function $(id) {
    return document.getElementById(id);
  }

  function fmtInt(value) {
    return Number(value).toLocaleString("en-US");
  }

  function fmtPct(value, digits) {
    var d = digits === undefined ? 1 : digits;
    return (value * 100).toFixed(d) + "%";
  }

  function setStatus(el, message, isError) {
    if (!el) {
      return;
    }
    el.textContent = message || "";
    el.classList.toggle("error", Boolean(isError));
  }

  function readNumber(el) {
    var value = parseFloat(el.value);
    return isFinite(value) ? value : NaN;
  }

  function drawNormal(n, p, rng) {
    var mean = n * p;
    var sd = Math.sqrt(n * p * (1 - p));
    var u1 = rng();
    if (u1 <= 0) {
      u1 = 1e-12;
    }
    var u2 = rng();
    var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    var x = Math.round(mean + sd * z);
    if (x < 0) {
      return 0;
    }
    if (x > n) {
      return n;
    }
    return x;
  }

  function drawBernoulliSum(n, p, rng) {
    var k = 0;
    for (var i = 0; i < n; i += 1) {
      if (rng() < p) {
        k += 1;
      }
    }
    return k;
  }

  /* Two binomial arms, normal approximation when the variance rule allows it. */
  function drawArm(n, p, rng) {
    if (n * p * (1 - p) > 25) {
      return drawNormal(n, p, rng);
    }
    return drawBernoulliSum(n, p, rng);
  }

  function runChunked(total, chunkSize, step, onProgress, onDone) {
    var index = 0;
    function tick() {
      var end = Math.min(index + chunkSize, total);
      for (; index < end; index += 1) {
        step(index);
      }
      if (index < total) {
        if (onProgress) {
          onProgress(index, total);
        }
        setTimeout(tick, 0);
      } else {
        onDone();
      }
    }
    tick();
  }

  /* ---------------------------------------------------------------- */
  /* Tool 1: sample size                                              */
  /* ---------------------------------------------------------------- */

  function initSampleSize() {
    var baselineEl = $("ss-baseline");
    if (!baselineEl) {
      return;
    }
    var liftEl = $("ss-lift");
    var alphaEl = $("ss-alpha");
    var powerEl = $("ss-power");
    var statusEl = $("ss-status");
    var resultEl = $("ss-result");

    function update() {
      var baselinePct = readNumber(baselineEl);
      var liftPct = readNumber(liftEl);
      var alpha = readNumber(alphaEl);
      var power = readNumber(powerEl);

      if (!(baselinePct > 0 && baselinePct < 100)) {
        setStatus(statusEl, "Baseline must be above 0% and below 100%.", true);
        resultEl.innerHTML = "";
        return;
      }
      if (!(liftPct > 0)) {
        setStatus(statusEl, "Minimum relative lift must be greater than 0%.", true);
        resultEl.innerHTML = "";
        return;
      }
      if (!(alpha > 0 && alpha < 1)) {
        setStatus(statusEl, "Alpha must be above 0 and below 1.", true);
        resultEl.innerHTML = "";
        return;
      }
      if (!(power > 0 && power < 1)) {
        setStatus(statusEl, "Power must be above 0 and below 1.", true);
        resultEl.innerHTML = "";
        return;
      }

      var pBase = baselinePct / 100;
      var relLift = liftPct / 100;
      if (pBase * (1 + relLift) >= 1) {
        setStatus(
          statusEl,
          "Baseline times (1 + lift) reaches 100%; lower the lift or baseline.",
          true
        );
        resultEl.innerHTML = "";
        return;
      }

      var perArm;
      try {
        perArm = S.sampleSizePerArm(pBase, relLift, alpha, power);
      } catch (err) {
        setStatus(statusEl, String(err.message || err), true);
        resultEl.innerHTML = "";
        return;
      }

      var p2 = pBase * (1 + relLift);
      setStatus(statusEl, "Recalculated as you type.", false);
      resultEl.innerHTML =
        '<p class="big">' +
        fmtInt(perArm) +
        " users per arm</p>" +
        "<dl>" +
        "<dt>Total users</dt><dd>" +
        fmtInt(perArm * 2) +
        "</dd>" +
        "<dt>Baseline rate</dt><dd>" +
        fmtPct(pBase, 2) +
        "</dd>" +
        "<dt>Treatment rate</dt><dd>" +
        fmtPct(p2, 2) +
        "</dd>" +
        "<dt>Absolute lift</dt><dd>" +
        fmtPct(p2 - pBase, 2) +
        "</dd>" +
        "<dt>Alpha</dt><dd>" +
        String(alpha) +
        "</dd>" +
        "<dt>Power</dt><dd>" +
        String(power) +
        "</dd>" +
        "</dl>";
    }

    [baselineEl, liftEl, alphaEl, powerEl].forEach(function (el) {
      el.addEventListener("input", update);
    });
    update();
  }

  /* ---------------------------------------------------------------- */
  /* Tool 2: A/A simulator                                            */
  /* ---------------------------------------------------------------- */

  function initAA() {
    var runEl = $("aa-run");
    if (!runEl) {
      return;
    }
    var rateEl = $("aa-rate");
    var usersEl = $("aa-users");
    var experimentsEl = $("aa-experiments");
    var seedEl = $("aa-seed");
    var statusEl = $("aa-status");
    var resultEl = $("aa-result");
    var chartEl = $("aa-chart");
    var running = false;

    function validate() {
      var ratePct = readNumber(rateEl);
      var users = readNumber(usersEl);
      var experiments = readNumber(experimentsEl);
      var seed = readNumber(seedEl);
      if (!(ratePct > 0 && ratePct < 100)) {
        return { error: "Baseline rate must be above 0% and below 100%." };
      }
      if (!(users >= 1) || users !== Math.round(users)) {
        return { error: "Users per arm must be a whole number of at least 1." };
      }
      if (!(experiments >= 1) || experiments !== Math.round(experiments)) {
        return { error: "Experiments must be a whole number of at least 1." };
      }
      if (experiments > 5000) {
        return { error: "Experiments cannot exceed 5,000." };
      }
      if (!isFinite(seed) || seed !== Math.round(seed)) {
        return { error: "Seed must be a whole number." };
      }
      return {
        rate: ratePct / 100,
        users: Math.round(users),
        experiments: Math.round(experiments),
        seed: Math.round(seed)
      };
    }

    runEl.addEventListener("click", function () {
      if (running) {
        return;
      }
      var params = validate();
      if (params.error) {
        setStatus(statusEl, params.error, true);
        resultEl.innerHTML = "";
        chartEl.innerHTML = "";
        return;
      }

      running = true;
      runEl.disabled = true;
      resultEl.innerHTML = "";
      chartEl.innerHTML = "";
      setStatus(statusEl, "Running\u2026", false);

      var rng = S.mulberry32(params.seed);
      var p = params.rate;
      var n = params.users;
      var total = params.experiments;
      var rejections = 0;
      var bins = new Array(20);
      var i;
      for (i = 0; i < 20; i += 1) {
        bins[i] = 0;
      }

      runChunked(
        total,
        50,
        function () {
          var xC = drawArm(n, p, rng);
          var xT = drawArm(n, p, rng);
          var test = S.twoProportionZ(xC, n, xT, n);
          var pValue = test.pValue;
          if (pValue < 0.05) {
            rejections += 1;
          }
          var bin = Math.floor(pValue * 20);
          if (bin < 0) {
            bin = 0;
          }
          if (bin > 19) {
            bin = 19;
          }
          bins[bin] += 1;
        },
        function (done, count) {
          setStatus(statusEl, "Running\u2026 " + fmtInt(done) + " / " + fmtInt(count), false);
        },
        function () {
          var share = rejections / total;
          var interval = S.wilson(rejections, total);
          resultEl.innerHTML =
            '<p class="big">' +
            fmtPct(share, 2) +
            " rejected at p &lt; 0.05</p>" +
            "<dl>" +
            "<dt>Experiments</dt><dd>" +
            fmtInt(total) +
            "</dd>" +
            "<dt>Rejections</dt><dd>" +
            fmtInt(rejections) +
            "</dd>" +
            "<dt>95% Wilson interval</dt><dd>" +
            fmtPct(interval[0], 2) +
            " \u2013 " +
            fmtPct(interval[1], 2) +
            "</dd>" +
            "<dt>Expected under the null</dt><dd>5.00%</dd>" +
            "</dl>";

          var rows = [];
          for (i = 0; i < 20; i += 1) {
            rows.push({
              label: (i / 20).toFixed(2),
              value: bins[i] / total
            });
          }
          chartEl.innerHTML = C.barChart(rows, {
            title:
              "Distribution of " +
              fmtInt(total) +
              " A/A p-values in 20 bins of width 0.05",
            format: function (value) {
              return fmtPct(value, 1);
            },
            rowHeight: 18,
            gap: 5,
            labelWidth: 54,
            valueWidth: 70
          });
          setStatus(statusEl, "Done.", false);
          running = false;
          runEl.disabled = false;
        }
      );
    });
  }

  /* ---------------------------------------------------------------- */
  /* Tool 3: peeking demo                                             */
  /* ---------------------------------------------------------------- */

  function initPeeking() {
    var runEl = $("pk-run");
    if (!runEl) {
      return;
    }
    var rateEl = $("pk-rate");
    var usersEl = $("pk-users");
    var daysEl = $("pk-days");
    var experimentsEl = $("pk-experiments");
    var seedEl = $("pk-seed");
    var statusEl = $("pk-status");
    var resultEl = $("pk-result");
    var chartEl = $("pk-chart");
    var running = false;

    function validate() {
      var ratePct = readNumber(rateEl);
      var users = readNumber(usersEl);
      var days = readNumber(daysEl);
      var experiments = readNumber(experimentsEl);
      var seed = readNumber(seedEl);
      if (!(ratePct > 0 && ratePct < 100)) {
        return { error: "Baseline rate must be above 0% and below 100%." };
      }
      if (!(users >= 1) || users !== Math.round(users)) {
        return { error: "Users per arm per day must be a whole number of at least 1." };
      }
      if (!(days >= 2) || days !== Math.round(days)) {
        return { error: "Days must be a whole number of at least 2." };
      }
      if (days > 90) {
        return { error: "Days cannot exceed 90." };
      }
      if (!(experiments >= 1) || experiments !== Math.round(experiments)) {
        return { error: "Experiments must be a whole number of at least 1." };
      }
      if (experiments > 5000) {
        return { error: "Experiments cannot exceed 5,000." };
      }
      if (!isFinite(seed) || seed !== Math.round(seed)) {
        return { error: "Seed must be a whole number." };
      }
      return {
        rate: ratePct / 100,
        users: Math.round(users),
        days: Math.round(days),
        experiments: Math.round(experiments),
        seed: Math.round(seed)
      };
    }

    runEl.addEventListener("click", function () {
      if (running) {
        return;
      }
      var params = validate();
      if (params.error) {
        setStatus(statusEl, params.error, true);
        resultEl.innerHTML = "";
        chartEl.innerHTML = "";
        return;
      }

      running = true;
      runEl.disabled = true;
      resultEl.innerHTML = "";
      chartEl.innerHTML = "";
      setStatus(statusEl, "Running\u2026", false);

      var rng = S.mulberry32(params.seed);
      var p = params.rate;
      var nDay = params.users;
      var days = params.days;
      var total = params.experiments;
      var finalRejections = 0;
      var anyWins = 0;
      var firstWinDay = new Array(days + 1);
      var d;
      for (d = 0; d <= days; d += 1) {
        firstWinDay[d] = 0;
      }

      runChunked(
        total,
        25,
        function () {
          var nC = 0;
          var nT = 0;
          var xC = 0;
          var xT = 0;
          var won = 0;
          var finalP = 1;
          for (var day = 1; day <= days; day += 1) {
            nC += nDay;
            nT += nDay;
            xC += drawArm(nDay, p, rng);
            xT += drawArm(nDay, p, rng);
            var test = S.twoProportionZ(xC, nC, xT, nT);
            if (day === days) {
              finalP = test.pValue;
            }
            if (won === 0 && test.pValue < 0.05) {
              won = day;
            }
          }
          if (finalP < 0.05) {
            finalRejections += 1;
          }
          if (won > 0) {
            anyWins += 1;
            firstWinDay[won] += 1;
          }
        },
        function (done, count) {
          setStatus(statusEl, "Running\u2026 " + fmtInt(done) + " / " + fmtInt(count), false);
        },
        function () {
          var fixedRate = finalRejections / total;
          var peekRate = anyWins / total;
          var fixedInterval = S.wilson(finalRejections, total);
          var peekInterval = S.wilson(anyWins, total);

          resultEl.innerHTML =
            "<dl>" +
            "<dt>Tested only at the end</dt><dd>" +
            fmtPct(fixedRate, 2) +
            " (95% CI " +
            fmtPct(fixedInterval[0], 2) +
            " \u2013 " +
            fmtPct(fixedInterval[1], 2) +
            ")</dd>" +
            "<dt>Stopped at first p &lt; 0.05</dt><dd>" +
            fmtPct(peekRate, 2) +
            " (95% CI " +
            fmtPct(peekInterval[0], 2) +
            " \u2013 " +
            fmtPct(peekInterval[1], 2) +
            ")</dd>" +
            "<dt>Looks per experiment</dt><dd>" +
            fmtInt(days) +
            "</dd>" +
            "<dt>Experiments</dt><dd>" +
            fmtInt(total) +
            "</dd>" +
            "</dl>";

          var cumulative = [];
          var running2 = 0;
          var xLabels = [];
          for (d = 1; d <= days; d += 1) {
            running2 += firstWinDay[d];
            cumulative.push(running2 / total);
            xLabels.push(String(d));
          }
          var flat = [];
          for (d = 1; d <= days; d += 1) {
            flat.push(fixedRate);
          }
          chartEl.innerHTML = C.lineChart(
            [
              { name: "First win by day", values: cumulative },
              { name: "Only at the end", values: flat }
            ],
            {
              title:
                "Cumulative share of A/A experiments falsely won, by day (day " +
                days +
                ")",
              xLabels: xLabels,
              yMin: 0,
              format: function (value) {
                return fmtPct(value, 0);
              }
            }
          );
          setStatus(statusEl, "Done.", false);
          running = false;
          runEl.disabled = false;
        }
      );
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initSampleSize();
    initAA();
    initPeeking();
  });
})();
