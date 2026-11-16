/* Pure SVG chart builders for the Buyer Analytics site.
 *
 * Each helper takes plain arrays and objects and returns an SVG string with a
 * viewBox and width="100%". Colours come from CSS custom properties and
 * currentColor so the charts follow the active theme. All text is escaped.
 */
(function (global) {
  "use strict";

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  function defaultFormat(value) {
    if (!isNum(value)) {
      return "\u2014";
    }
    var av = Math.abs(value);
    if (av >= 1000) {
      return Math.round(value).toLocaleString("en-US");
    }
    if (av >= 1) {
      return String(Math.round(value * 100) / 100);
    }
    if (av === 0) {
      return "0";
    }
    return String(Math.round(value * 10000) / 10000);
  }

  var DASH = "\u2014";

  /* Integer with thousands separators. */
  function formatInt(value) {
    if (!isNum(value)) {
      return DASH;
    }
    return Math.round(value).toLocaleString("en-US");
  }

  /* Share as a percentage with a fixed number of decimals (2 by default). */
  function formatPct(value, digits) {
    if (!isNum(value)) {
      return DASH;
    }
    var d = digits === undefined ? 2 : digits;
    return (value * 100).toFixed(d) + "%";
  }

  /* Dollars with thousands separators; whole dollars at or above $1,000. */
  function formatMoney(value) {
    if (!isNum(value)) {
      return DASH;
    }
    var sign = value < 0 ? "-" : "";
    var av = Math.abs(value);
    if (av >= 1000) {
      return sign + "$" + Math.round(av).toLocaleString("en-US");
    }
    return (
      sign +
      "$" +
      av.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );
  }

  /* One value formatted for its kind: rate, money, count or a plain number. */
  function formatValue(value, kind) {
    if (kind === "rate") {
      return formatPct(value);
    }
    if (kind === "money") {
      return formatMoney(value);
    }
    if (kind === "count") {
      return formatInt(value);
    }
    if (kind === "log") {
      return isNum(value) ? (Math.round(value * 1000) / 1000).toFixed(3) : DASH;
    }
    return isNum(value) ? String(Math.round(value * 100) / 100) : DASH;
  }

  /* The interval-and-n tail of a NUM, without repeating the point estimate. */
  function numDetail(num, kind) {
    if (!num || typeof num !== "object") {
      return "";
    }
    if (num.ci_low === null || num.ci_low === undefined) {
      return "n = " + formatInt(num.n);
    }
    return (
      "95% CI " +
      formatValue(num.ci_low, kind) +
      " to " +
      formatValue(num.ci_high, kind) +
      ", n = " +
      formatInt(num.n)
    );
  }

  /* A published estimate: value (95% CI low to high, n = N), or value (n = N). */
  function formatNum(num, kind) {
    if (!num || typeof num !== "object") {
      return DASH;
    }
    var head = formatValue(num.value, kind);
    var detail = numDetail(num, kind);
    return detail ? head + " (" + detail + ")" : head;
  }

  function open(title, width, height) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" class="chart" viewBox="0 0 ' +
      width +
      " " +
      height +
      '" width="100%" height="' +
      height +
      '" role="img" preserveAspectRatio="xMidYMid meet">' +
      "<title>" +
      esc(title || "Chart") +
      "</title>"
    );
  }

  function text(x, y, value, cls, anchor, extra) {
    return (
      '<text x="' +
      x +
      '" y="' +
      y +
      '" class="' +
      cls +
      '"' +
      (anchor ? ' text-anchor="' + anchor + '"' : "") +
      (extra || "") +
      ">" +
      esc(value) +
      "</text>"
    );
  }

  /* Horizontal bars with an optional error bar from ci_low to ci_high. */
  function barChart(rows, opts) {
    rows = rows || [];
    opts = opts || {};
    var width = opts.width || 680;
    var rowHeight = opts.rowHeight || 26;
    var gap = opts.gap || 12;
    var valueWidth = opts.valueWidth || 90;
    var top = 8;
    var bottom = 8;
    var format = opts.format || defaultFormat;

    var maxLabel = 0;
    for (var i = 0; i < rows.length; i += 1) {
      maxLabel = Math.max(maxLabel, String(rows[i].label || "").length);
    }
    var labelWidth = opts.labelWidth || Math.min(width * 0.42, maxLabel * 7 + 14);
    labelWidth = Math.max(72, labelWidth);

    var plotX = labelWidth;
    var plotRight = width - valueWidth;
    var plotW = Math.max(10, plotRight - plotX);
    var height = top + Math.max(0, rows.length * (rowHeight + gap) - gap) + bottom;

    var maxValue = 0;
    for (var j = 0; j < rows.length; j += 1) {
      var row = rows[j];
      maxValue = Math.max(maxValue, isNum(row.value) ? row.value : 0);
      if (isNum(row.ci_high)) {
        maxValue = Math.max(maxValue, row.ci_high);
      }
    }
    if (!(maxValue > 0)) {
      maxValue = 1;
    }
    var scale = plotW / maxValue;

    var out = open(opts.title || "Bar chart", width, height);
    out +=
      '<line x1="' +
      plotX +
      '" y1="' +
      top +
      '" x2="' +
      plotX +
      '" y2="' +
      (height - bottom) +
      '" stroke="var(--rule)" stroke-width="1" />';

    for (var k = 0; k < rows.length; k += 1) {
      var r = rows[k];
      var y = top + k * (rowHeight + gap);
      var cy = y + rowHeight / 2;
      var value = isNum(r.value) ? r.value : 0;
      var barW = Math.max(1, value * scale);

      out += text(labelWidth - 10, cy, r.label, "chart-label", "end", ' dy="0.35em"');
      out +=
        '<rect x="' +
        plotX +
        '" y="' +
        y +
        '" width="' +
        barW.toFixed(2) +
        '" height="' +
        rowHeight +
        '" rx="3" fill="var(--accent)" class="chart-bar" />';

      if (isNum(r.ci_low) || isNum(r.ci_high)) {
        var low = isNum(r.ci_low) ? r.ci_low : value;
        var high = isNum(r.ci_high) ? r.ci_high : value;
        var x1 = plotX + Math.max(0, low) * scale;
        var x2 = plotX + Math.max(0, high) * scale;
        out +=
          '<line x1="' +
          x1.toFixed(2) +
          '" y1="' +
          cy +
          '" x2="' +
          x2.toFixed(2) +
          '" y2="' +
          cy +
          '" stroke="var(--accent-2)" stroke-width="1.5" />';
        out +=
          '<line x1="' +
          x1.toFixed(2) +
          '" y1="' +
          (cy - 5) +
          '" x2="' +
          x1.toFixed(2) +
          '" y2="' +
          (cy + 5) +
          '" stroke="var(--accent-2)" stroke-width="1.5" />';
        out +=
          '<line x1="' +
          x2.toFixed(2) +
          '" y1="' +
          (cy - 5) +
          '" x2="' +
          x2.toFixed(2) +
          '" y2="' +
          (cy + 5) +
          '" stroke="var(--accent-2)" stroke-width="1.5" />';
      }

      out += text(width - 6, cy, format(r.value), "chart-value", "end", ' dy="0.35em"');
    }

    return out + "</svg>";
  }

  /* Horizontal bars around a zero baseline, with error bars. Positive values
   * grow right, negative values grow left. */
  function divergingBarChart(rows, opts) {
    rows = rows || [];
    opts = opts || {};
    var width = opts.width || 680;
    var rowHeight = opts.rowHeight || 26;
    var gap = opts.gap || 12;
    var valueWidth = opts.valueWidth || 90;
    var top = 8;
    var bottom = 8;
    var format = opts.format || defaultFormat;

    var maxLabel = 0;
    for (var i = 0; i < rows.length; i += 1) {
      maxLabel = Math.max(maxLabel, String(rows[i].label || "").length);
    }
    var labelWidth = opts.labelWidth || Math.min(width * 0.42, maxLabel * 7 + 14);
    labelWidth = Math.max(72, labelWidth);

    var plotX = labelWidth;
    var plotRight = width - valueWidth;
    var plotW = Math.max(10, plotRight - plotX);
    var height = top + Math.max(0, rows.length * (rowHeight + gap) - gap) + bottom;

    var lo = 0;
    var hi = 0;
    for (var j = 0; j < rows.length; j += 1) {
      var row = rows[j];
      if (isNum(row.value)) {
        lo = Math.min(lo, row.value);
        hi = Math.max(hi, row.value);
      }
      if (isNum(row.ci_low)) {
        lo = Math.min(lo, row.ci_low);
      }
      if (isNum(row.ci_high)) {
        hi = Math.max(hi, row.ci_high);
      }
    }
    if (lo === hi) {
      hi = lo + 1;
    }
    var span = hi - lo || 1;
    var scale = plotW / span;
    function px(value) {
      return plotX + (value - lo) * scale;
    }
    var zeroX = px(0);

    var out = open(opts.title || "Diverging bar chart", width, height);
    out +=
      '<line x1="' +
      zeroX.toFixed(2) +
      '" y1="' +
      top +
      '" x2="' +
      zeroX.toFixed(2) +
      '" y2="' +
      (height - bottom) +
      '" stroke="var(--rule)" stroke-width="1" />';

    for (var k = 0; k < rows.length; k += 1) {
      var r = rows[k];
      var y = top + k * (rowHeight + gap);
      var cy = y + rowHeight / 2;
      var value = isNum(r.value) ? r.value : 0;
      var valueX = px(value);
      var x = Math.min(zeroX, valueX);
      var barW = Math.max(1, Math.abs(valueX - zeroX));

      out += text(labelWidth - 10, cy, r.label, "chart-label", "end", ' dy="0.35em"');
      out +=
        '<rect x="' +
        x.toFixed(2) +
        '" y="' +
        y +
        '" width="' +
        barW.toFixed(2) +
        '" height="' +
        rowHeight +
        '" rx="3" fill="var(--accent)" class="chart-bar" />';

      if (isNum(r.ci_low) || isNum(r.ci_high)) {
        var low = isNum(r.ci_low) ? r.ci_low : value;
        var high = isNum(r.ci_high) ? r.ci_high : value;
        var x1 = px(low);
        var x2 = px(high);
        out +=
          '<line x1="' +
          x1.toFixed(2) +
          '" y1="' +
          cy +
          '" x2="' +
          x2.toFixed(2) +
          '" y2="' +
          cy +
          '" stroke="var(--accent-2)" stroke-width="1.5" />';
        out +=
          '<line x1="' +
          x1.toFixed(2) +
          '" y1="' +
          (cy - 5) +
          '" x2="' +
          x1.toFixed(2) +
          '" y2="' +
          (cy + 5) +
          '" stroke="var(--accent-2)" stroke-width="1.5" />';
        out +=
          '<line x1="' +
          x2.toFixed(2) +
          '" y1="' +
          (cy - 5) +
          '" x2="' +
          x2.toFixed(2) +
          '" y2="' +
          (cy + 5) +
          '" stroke="var(--accent-2)" stroke-width="1.5" />';
      }

      out += text(width - 6, cy, format(r.value), "chart-value", "end", ' dy="0.35em"');
    }

    return out + "</svg>";
  }

  /* Line chart with x labels, one or more series and an optional shaded band. */
  function lineChart(series, opts) {
    series = series || [];
    opts = opts || {};
    var width = opts.width || 680;
    var height = opts.height || 280;
    var padLeft = opts.padLeft || 72;
    var padRight = 40;
    var padTop = opts.padTop || 18;
    var padBottom = 42;
    var plotW = width - padLeft - padRight;
    var plotH = height - padTop - padBottom;
    var xLabels = opts.xLabels || [];
    var band = opts.band || null;
    var colors = opts.colors || ["var(--accent)", "var(--accent-2)", "var(--ink)"];

    var n = 0;
    for (var s = 0; s < series.length; s += 1) {
      n = Math.max(n, (series[s].values || []).length);
    }
    if (n === 0 && xLabels.length) {
      n = xLabels.length;
    }
    if (n === 0) {
      n = 1;
    }

    var lo = Infinity;
    var hi = -Infinity;
    function consider(v) {
      if (isNum(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    for (var si = 0; si < series.length; si += 1) {
      (series[si].values || []).forEach(consider);
    }
    if (band) {
      (band.low || []).forEach(consider);
      (band.high || []).forEach(consider);
    }
    if (!isFinite(lo) || !isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (lo === hi) {
      lo -= 0.5;
      hi += 0.5;
    }
    if (isNum(opts.yMin)) {
      lo = opts.yMin;
    }
    if (isNum(opts.yMax)) {
      hi = opts.yMax;
    }
    var pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    var span = hi - lo || 1;

    function px(i) {
      return padLeft + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
    }
    function py(v) {
      return padTop + plotH * (1 - (v - lo) / span);
    }

    var out = open(opts.title || "Line chart", width, height);

    var ticks = 4;
    var format = opts.format || defaultFormat;
    for (var t = 0; t <= ticks; t += 1) {
      var tv = lo + (span * t) / ticks;
      var ty = py(tv);
      out +=
        '<line x1="' +
        padLeft +
        '" y1="' +
        ty.toFixed(2) +
        '" x2="' +
        (width - padRight) +
        '" y2="' +
        ty.toFixed(2) +
        '" stroke="var(--rule)" stroke-width="1" />';
      out += text(padLeft - 8, ty, format(tv), "chart-label", "end", ' dy="0.35em"');
    }

    if (band && (band.low || []).length && (band.high || []).length) {
      var pts = [];
      for (var bi = 0; bi < band.high.length; bi += 1) {
        if (isNum(band.high[bi])) {
          pts.push(px(bi).toFixed(2) + "," + py(band.high[bi]).toFixed(2));
        }
      }
      for (var bj = band.low.length - 1; bj >= 0; bj -= 1) {
        if (isNum(band.low[bj])) {
          pts.push(px(bj).toFixed(2) + "," + py(band.low[bj]).toFixed(2));
        }
      }
      if (pts.length) {
        out +=
          '<polygon points="' +
          pts.join(" ") +
          '" fill="var(--accent)" fill-opacity="0.12" stroke="none" />';
      }
    }

    for (var sj = 0; sj < series.length; sj += 1) {
      var values = series[sj].values || [];
      var points = [];
      for (var vi = 0; vi < values.length; vi += 1) {
        if (isNum(values[vi])) {
          points.push(px(vi).toFixed(2) + "," + py(values[vi]).toFixed(2));
        }
      }
      if (points.length) {
        out +=
          '<polyline points="' +
          points.join(" ") +
          '" fill="none" stroke="' +
          colors[sj % colors.length] +
          '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />';
      }
    }

    var labelStep = Math.max(1, Math.ceil(xLabels.length / 8));
    for (var li = 0; li < xLabels.length; li += 1) {
      if (li % labelStep === 0 || li === xLabels.length - 1) {
        out += text(
          px(li),
          height - padBottom + 18,
          xLabels[li],
          "chart-label",
          "middle"
        );
      }
    }

    var legendX = padLeft;
    for (var lj = 0; lj < series.length; lj += 1) {
      var name = series[lj].name || "series " + (lj + 1);
      out +=
        '<line x1="' +
        legendX +
        '" y1="' +
        (padTop - 6) +
        '" x2="' +
        (legendX + 16) +
        '" y2="' +
        (padTop - 6) +
        '" stroke="' +
        colors[lj % colors.length] +
        '" stroke-width="2" />';
      out += text(legendX + 22, padTop - 6, name, "chart-label", "start", ' dy="0.35em"');
      legendX += 24 + String(name).length * 7;
    }

    return out + "</svg>";
  }

  /* Grid of cells shaded by value, with the value printed in each cell. */
  function heatmap(matrix, rowLabels, colLabels, opts) {
    matrix = matrix || [];
    rowLabels = rowLabels || [];
    colLabels = colLabels || [];
    opts = opts || {};
    var cell = opts.cell || 34;
    var topH = 20;
    var format = opts.format || defaultFormat;
    var rows = rowLabels.length;
    var cols = colLabels.length;

    var maxLabel = 0;
    for (var r = 0; r < rows; r += 1) {
      maxLabel = Math.max(maxLabel, String(rowLabels[r]).length);
    }
    var leftW = opts.leftWidth || Math.min(180, maxLabel * 7 + 12);
    leftW = Math.max(60, leftW);
    var width = leftW + cols * cell + 8;
    var height = topH + rows * cell + 8;

    var maxValue = isNum(opts.max) ? opts.max : 0;
    for (var i = 0; i < rows; i += 1) {
      var rowVals = matrix[i] || [];
      for (var j = 0; j < cols; j += 1) {
        if (isNum(rowVals[j])) {
          maxValue = Math.max(maxValue, rowVals[j]);
        }
      }
    }
    if (!(maxValue > 0)) {
      maxValue = 1;
    }

    var out = open(opts.title || "Heatmap", width, height);

    for (var c = 0; c < cols; c += 1) {
      out += text(
        leftW + c * cell + cell / 2,
        topH - 6,
        colLabels[c],
        "chart-label",
        "middle"
      );
    }
    for (var ri = 0; ri < rows; ri += 1) {
      out += text(
        leftW - 8,
        topH + ri * cell + cell / 2,
        rowLabels[ri],
        "chart-label",
        "end",
        ' dy="0.35em"'
      );
      var rowVals2 = matrix[ri] || [];
      for (var ci = 0; ci < cols; ci += 1) {
        var value = rowVals2[ci];
        var x = leftW + ci * cell;
        var y = topH + ri * cell;
        if (isNum(value)) {
          var ratio = Math.max(0, Math.min(1, value / maxValue));
          var opacity = (0.06 + 0.74 * ratio).toFixed(3);
          out +=
            '<rect x="' +
            x +
            '" y="' +
            y +
            '" width="' +
            (cell - 2) +
            '" height="' +
            (cell - 2) +
            '" rx="3" fill="var(--accent)" fill-opacity="' +
            opacity +
            '" />';
          out += text(
            x + (cell - 2) / 2,
            y + (cell - 2) / 2,
            format(value),
            "chart-cell",
            "middle",
            ' dy="0.35em" fill="' +
              (ratio > 0.6 ? "var(--surface)" : "var(--ink)") +
              '"'
          );
        } else {
          out +=
            '<rect x="' +
            x +
            '" y="' +
            y +
            '" width="' +
            (cell - 2) +
            '" height="' +
            (cell - 2) +
            '" rx="3" fill="var(--rule)" fill-opacity="0.5" />';
          out += text(
            x + (cell - 2) / 2,
            y + (cell - 2) / 2,
            "\u2014",
            "chart-cell",
            "middle",
            ' dy="0.35em" fill="var(--muted)"'
          );
        }
      }
    }

    return out + "</svg>";
  }

  /* Funnel bars shrinking by step, with counts and step-to-step rates. */
  function funnelChart(steps, opts) {
    steps = steps || [];
    opts = opts || {};
    var width = opts.width || 680;
    var rowHeight = opts.rowHeight || 26;
    var gap = opts.gap || 22;
    var countWidth = opts.countWidth || 110;
    var top = 8;
    var format = opts.format || defaultFormat;

    var maxLabel = 0;
    for (var i = 0; i < steps.length; i += 1) {
      maxLabel = Math.max(maxLabel, String(steps[i].label || "").length);
    }
    var labelWidth = opts.labelWidth || Math.min(width * 0.4, maxLabel * 7 + 14);
    labelWidth = Math.max(80, labelWidth);

    var plotX = labelWidth;
    var plotRight = width - countWidth;
    var plotW = Math.max(10, plotRight - plotX);
    var height = top + Math.max(0, steps.length * (rowHeight + gap) - gap) + 8;

    var maxCount = 0;
    for (var j = 0; j < steps.length; j += 1) {
      maxCount = Math.max(maxCount, steps[j].count || 0);
    }
    if (!(maxCount > 0)) {
      maxCount = 1;
    }

    var out = open(opts.title || "Funnel", width, height);
    out +=
      '<line x1="' +
      plotX +
      '" y1="' +
      top +
      '" x2="' +
      plotX +
      '" y2="' +
      (height - 8) +
      '" stroke="var(--rule)" stroke-width="1" />';

    for (var k = 0; k < steps.length; k += 1) {
      var step = steps[k];
      var y = top + k * (rowHeight + gap);
      var cy = y + rowHeight / 2;
      var count = step.count || 0;
      var barW = Math.max(1, (count / maxCount) * plotW);

      out += text(labelWidth - 10, cy, step.label, "chart-label", "end", ' dy="0.35em"');
      out +=
        '<rect x="' +
        plotX +
        '" y="' +
        y +
        '" width="' +
        barW.toFixed(2) +
        '" height="' +
        rowHeight +
        '" rx="3" fill="var(--accent)" class="chart-bar" />';
      out += text(plotX + barW + 8, cy, format(count), "chart-value", "start", ' dy="0.35em"');

      if (k > 0) {
        var prev = steps[k - 1].count || 0;
        var rate = prev > 0 ? count / prev : NaN;
        var rateText = isNum(rate)
          ? (rate * 100).toFixed(1) + "% of previous step"
          : "no previous step";
        out += text(
          plotX,
          y - gap / 2 + 4,
          "\u2193 " + rateText,
          "chart-label",
          "start"
        );
      }
    }

    return out + "</svg>";
  }

  var api = {
    barChart: barChart,
    divergingBarChart: divergingBarChart,
    lineChart: lineChart,
    heatmap: heatmap,
    funnelChart: funnelChart,
    formatInt: formatInt,
    formatPct: formatPct,
    formatMoney: formatMoney,
    formatValue: formatValue,
    formatNum: formatNum,
    numDetail: numDetail,
    escape: esc
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.Charts = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
