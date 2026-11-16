/* Pure SVG chart builders for the Buyer Analytics site.
 *
 * Each helper takes plain arrays and objects and returns an SVG string with a
 * viewBox and width="100%". Colours come from CSS custom properties so the
 * charts follow the active theme. All text is escaped. Nothing here touches the
 * DOM, so the module loads under Node for testing.
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

  var DASH = "\u2014";

  function defaultFormat(value) {
    if (!isNum(value)) {
      return DASH;
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

  function open(title, width, height, desc) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" class="chart" viewBox="0 0 ' +
      width +
      " " +
      height +
      '" width="100%" role="img" preserveAspectRatio="xMidYMid meet">' +
      "<title>" +
      esc(title || "Chart") +
      "</title>" +
      (desc ? "<desc>" + esc(desc) + "</desc>" : "")
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

  /* Horizontal bars with an optional interval whisker from ci_low to ci_high. */
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
    var barFill = opts.fill || "var(--accent)";

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

    var out = open(opts.title || "Bar chart", width, height, opts.desc);
    out +=
      '<line x1="' +
      plotX +
      '" y1="' +
      top +
      '" x2="' +
      plotX +
      '" y2="' +
      (height - bottom) +
      '" stroke="var(--border)" stroke-width="1" />';

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
        '" rx="3" fill="' +
        barFill +
        '" class="chart-bar" />';

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
          '" stroke="var(--ink-2)" stroke-width="1.5" />';
        out +=
          '<line x1="' +
          x1.toFixed(2) +
          '" y1="' +
          (cy - 5) +
          '" x2="' +
          x1.toFixed(2) +
          '" y2="' +
          (cy + 5) +
          '" stroke="var(--ink-2)" stroke-width="1.5" />';
        out +=
          '<line x1="' +
          x2.toFixed(2) +
          '" y1="' +
          (cy - 5) +
          '" x2="' +
          x2.toFixed(2) +
          '" y2="' +
          (cy + 5) +
          '" stroke="var(--ink-2)" stroke-width="1.5" />';
      }

      out += text(width - 6, cy, format(r.value), "chart-value", "end", ' dy="0.35em"');
    }

    return out + "</svg>";
  }

  /* Horizontal bars around a zero baseline, with interval whiskers. Positive
   * values grow right, negative values grow left and take the lost colour. */
  function divergingBarChart(rows, opts) {
    rows = rows || [];
    opts = opts || {};
    var width = opts.width || 680;
    var rowHeight = opts.rowHeight || 30;
    var gap = opts.gap || 16;
    var valueWidth = opts.valueWidth || 96;
    var top = 8;
    var bottom = 8;
    var format = opts.format || defaultFormat;

    var maxLabel = 0;
    for (var i = 0; i < rows.length; i += 1) {
      maxLabel = Math.max(maxLabel, String(rows[i].label || "").length);
    }
    var labelWidth = opts.labelWidth || Math.min(width * 0.4, maxLabel * 7 + 14);
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

    var out = open(opts.title || "Diverging bar chart", width, height, opts.desc);
    out +=
      '<line x1="' +
      zeroX.toFixed(2) +
      '" y1="' +
      top +
      '" x2="' +
      zeroX.toFixed(2) +
      '" y2="' +
      (height - bottom) +
      '" stroke="var(--border)" stroke-width="1" />';

    for (var k = 0; k < rows.length; k += 1) {
      var r = rows[k];
      var y = top + k * (rowHeight + gap);
      var cy = y + rowHeight / 2;
      var value = isNum(r.value) ? r.value : 0;
      var valueX = px(value);
      var x = Math.min(zeroX, valueX);
      var barW = Math.max(1, Math.abs(valueX - zeroX));
      var fill = value < 0 ? "var(--lost)" : "var(--accent)";

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
        '" rx="3" fill="' +
        fill +
        '" class="chart-bar" />';

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
          '" stroke="var(--ink-2)" stroke-width="1.5" />';
        out +=
          '<line x1="' +
          x1.toFixed(2) +
          '" y1="' +
          (cy - 5) +
          '" x2="' +
          x1.toFixed(2) +
          '" y2="' +
          (cy + 5) +
          '" stroke="var(--ink-2)" stroke-width="1.5" />';
        out +=
          '<line x1="' +
          x2.toFixed(2) +
          '" y1="' +
          (cy - 5) +
          '" x2="' +
          x2.toFixed(2) +
          '" y2="' +
          (cy + 5) +
          '" stroke="var(--ink-2)" stroke-width="1.5" />';
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
    var padTop = opts.padTop || 30;
    var padBottom = 42;
    var plotW = width - padLeft - padRight;
    var plotH = height - padTop - padBottom;
    var xLabels = opts.xLabels || [];
    var band = opts.band || null;
    var colors = opts.colors || ["var(--accent)", "var(--ink-3)", "var(--lost)"];

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

    var out = open(opts.title || "Line chart", width, height, opts.desc);

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
        '" stroke="var(--border)" stroke-width="1" />';
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
      for (var di = 0; di < values.length; di += 1) {
        if (isNum(values[di])) {
          out +=
            '<circle cx="' +
            px(di).toFixed(2) +
            '" cy="' +
            py(values[di]).toFixed(2) +
            '" r="2.5" fill="' +
            colors[sj % colors.length] +
            '" />';
        }
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
        (padTop - 12) +
        '" x2="' +
        (legendX + 16) +
        '" y2="' +
        (padTop - 12) +
        '" stroke="' +
        colors[lj % colors.length] +
        '" stroke-width="2" />';
      out += text(legendX + 22, padTop - 12, name, "chart-label", "start", ' dy="0.35em"');
      legendX += 30 + String(name).length * 7;
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
    var topH = 22;
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

    var out = open(opts.title || "Heatmap", width, height, opts.desc);

    for (var c = 0; c < cols; c += 1) {
      out += text(
        leftW + c * cell + cell / 2,
        topH - 8,
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
          var step = Math.min(5, Math.round(ratio * 5));
          out +=
            '<rect x="' +
            x +
            '" y="' +
            y +
            '" width="' +
            (cell - 2) +
            '" height="' +
            (cell - 2) +
            '" rx="3" fill="var(--heat-' +
            step +
            ')" />';
          out += text(
            x + (cell - 2) / 2,
            y + (cell - 2) / 2,
            format(value),
            "chart-cell heat-ink-" + step,
            "middle",
            ' dy="0.35em"'
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
            '" rx="3" fill="var(--surface-2)" />';
          out += text(
            x + (cell - 2) / 2,
            y + (cell - 2) / 2,
            DASH,
            "chart-cell",
            "middle",
            ' dy="0.35em"'
          );
        }
      }
    }

    return out + "</svg>";
  }

  /* Closed and open funnel counts as two aligned bar series per step. */
  function pairedStepChart(rows, opts) {
    rows = rows || [];
    opts = opts || {};
    var width = opts.width || 680;
    var rowHeight = opts.rowHeight || 30;
    var gap = opts.gap || 20;
    var valueWidth = opts.valueWidth || 96;
    var top = 10;
    var bottom = 10;
    var format = opts.format || defaultFormat;

    var maxLabel = 0;
    for (var i = 0; i < rows.length; i += 1) {
      maxLabel = Math.max(maxLabel, String(rows[i].label || "").length);
    }
    var labelWidth = opts.labelWidth || Math.min(width * 0.34, maxLabel * 7 + 14);
    labelWidth = Math.max(80, labelWidth);

    var plotX = labelWidth;
    var plotRight = width - valueWidth;
    var plotW = Math.max(10, plotRight - plotX);
    var pairH = 12;
    var pairGap = 4;
    var height = top + rows.length * (rowHeight + gap) - gap + bottom;

    var maxValue = 0;
    for (var j = 0; j < rows.length; j += 1) {
      maxValue = Math.max(maxValue, rows[j].closed || 0, rows[j].open || 0);
    }
    if (!(maxValue > 0)) {
      maxValue = 1;
    }
    var scale = plotW / maxValue;

    var out = open(opts.title || "Closed and open funnel", width, height, opts.desc);
    out +=
      '<line x1="' +
      plotX +
      '" y1="' +
      top +
      '" x2="' +
      plotX +
      '" y2="' +
      (height - bottom) +
      '" stroke="var(--border)" stroke-width="1" />';

    for (var k = 0; k < rows.length; k += 1) {
      var r = rows[k];
      var y = top + k * (rowHeight + gap);
      var closedW = Math.max(1, (r.closed || 0) * scale);
      var openW = Math.max(1, (r.open || 0) * scale);
      out += text(labelWidth - 10, y + rowHeight / 2, r.label, "chart-label", "end", ' dy="0.35em"');
      out +=
        '<rect x="' +
        plotX +
        '" y="' +
        y +
        '" width="' +
        closedW.toFixed(2) +
        '" height="' +
        pairH +
        '" rx="2" fill="var(--accent)" />';
      out +=
        '<rect x="' +
        plotX +
        '" y="' +
        (y + pairH + pairGap) +
        '" width="' +
        openW.toFixed(2) +
        '" height="' +
        pairH +
        '" rx="2" fill="var(--accent-soft-strong)" />';
      out += text(plotX + Math.max(closedW, openW) + 8, y + rowHeight / 2, format(r.closed), "chart-value", "start", ' dy="0.35em"');
    }

    out +=
      '<line x1="' +
      plotX +
      '" y1="' +
      (height - bottom + 2) +
      '" x2="' +
      plotX +
      '" y2="' +
      (height - bottom + 2) +
      '" stroke="none" />';
    out += text(plotX, height - 2, "\u25A0 closed (needs every earlier step)", "chart-label", "start");
    out += text(plotX + 250, height - 2, "\u25A0 open (step event present)", "chart-label", "start");
    return out + "</svg>";
  }

  /* A waterfall from one revenue figure to the next. */
  function bridgeChart(spec, opts) {
    opts = opts || {};
    spec = spec || {};
    var steps = spec.steps || [];
    var start = spec.start || {};
    var end = spec.end || {};
    var format = opts.format || defaultFormat;
    var width = opts.width || 680;
    var rowHeight = opts.rowHeight || 30;
    var gap = opts.gap || 16;
    var labelWidth = opts.labelWidth || 150;
    var valueWidth = opts.valueWidth || 96;
    var top = 8;
    var bottom = 8;

    var rows = [{ label: start.label, from: 0, to: start.value, kind: "total" }];
    var cum = isNum(start.value) ? start.value : 0;
    for (var i = 0; i < steps.length; i += 1) {
      var s = steps[i];
      var delta = isNum(s.delta) ? s.delta : 0;
      rows.push({ label: s.label, from: cum, to: cum + delta, kind: delta < 0 ? "fall" : "rise", delta: delta });
      cum += delta;
    }
    rows.push({ label: end.label, from: 0, to: cum, kind: "total" });

    var plotX = labelWidth;
    var plotRight = width - valueWidth;
    var plotW = Math.max(10, plotRight - plotX);
    var height = top + rows.length * (rowHeight + gap) - gap + bottom;

    var maxValue = 0;
    for (var j = 0; j < rows.length; j += 1) {
      maxValue = Math.max(maxValue, rows[j].from || 0, rows[j].to || 0);
    }
    if (!(maxValue > 0)) {
      maxValue = 1;
    }
    var scale = plotW / maxValue;

    var out = open(opts.title || "Revenue bridge", width, height, opts.desc);

    for (var k = 0; k < rows.length; k += 1) {
      var r = rows[k];
      var y = top + k * (rowHeight + gap);
      var x0 = plotX + Math.min(r.from, r.to) * scale;
      var x1 = plotX + Math.max(r.from, r.to) * scale;
      var barW = Math.max(2, x1 - x0);
      var fill =
        r.kind === "total" ? "var(--accent)" : r.kind === "fall" ? "var(--lost)" : "var(--accent)";

      out += text(labelWidth - 12, y + rowHeight / 2, r.label, "chart-label", "end", ' dy="0.35em"');
      out +=
        '<rect class="bridge-bar" style="--i:' +
        k +
        '" x="' +
        x0.toFixed(2) +
        '" y="' +
        y +
        '" width="' +
        barW.toFixed(2) +
        '" height="' +
        rowHeight +
        '" rx="3" fill="' +
        fill +
        '" />';

      if (r.kind !== "total" && isNum(r.delta)) {
        var labelX = r.delta < 0 ? x0 - 6 : x1 + 6;
        var anchor = r.delta < 0 ? "end" : "start";
        out += text(labelX, y + rowHeight / 2, (r.delta < 0 ? "" : "+") + format(r.delta), "chart-value", anchor, ' dy="0.35em"');
      } else {
        out += text(width - 6, y + rowHeight / 2, format(r.to), "chart-value", "end", ' dy="0.35em"');
      }

      if (k < rows.length - 1) {
        var next = rows[k + 1];
        var linkY = y + rowHeight;
        var linkX = plotX + (r.kind === "total" ? r.to : r.to) * scale;
        out +=
          '<line x1="' +
          linkX.toFixed(2) +
          '" y1="' +
          linkY +
          '" x2="' +
          linkX.toFixed(2) +
          '" y2="' +
          (next.kind === "total" ? linkY + gap + (next.from === 0 ? rowHeight : 0) : linkY + gap) +
          '" stroke="var(--border)" stroke-width="1" />';
      }
    }

    return out + "</svg>";
  }

  /* Small inline bar sparkline for finding cards. */
  function sparkBars(values, opts) {
    values = values || [];
    opts = opts || {};
    var width = opts.width || 150;
    var height = opts.height || 44;
    var pad = 3;
    var n = values.length || 1;
    var maxValue = 0;
    for (var i = 0; i < values.length; i += 1) {
      if (isNum(values[i])) {
        maxValue = Math.max(maxValue, values[i]);
      }
    }
    if (!(maxValue > 0)) {
      maxValue = 1;
    }
    var slot = (width - pad * 2) / n;
    var barW = Math.max(2, slot - 2);
    var out = open(opts.title || "Sparkline", width, height, opts.desc);
    for (var j = 0; j < values.length; j += 1) {
      if (!isNum(values[j])) {
        continue;
      }
      var h = Math.max(1, (values[j] / maxValue) * (height - pad * 2));
      var x = pad + j * slot;
      var fill = opts.highlight === j ? "var(--accent)" : "var(--accent-soft-strong)";
      out +=
        '<rect x="' +
        x.toFixed(2) +
        '" y="' +
        (height - pad - h).toFixed(2) +
        '" width="' +
        barW.toFixed(2) +
        '" height="' +
        h.toFixed(2) +
        '" rx="2" fill="' +
        fill +
        '" />';
    }
    return out + "</svg>";
  }

  /* Small inline line sparkline for finding cards. */
  function sparkLine(values, opts) {
    values = values || [];
    opts = opts || {};
    var width = opts.width || 150;
    var height = opts.height || 44;
    var pad = 4;
    var n = values.length;
    if (!n) {
      return open(opts.title || "Sparkline", width, height, opts.desc) + "</svg>";
    }
    var lo = Infinity;
    var hi = -Infinity;
    for (var i = 0; i < n; i += 1) {
      if (isNum(values[i])) {
        lo = Math.min(lo, values[i]);
        hi = Math.max(hi, values[i]);
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (lo === hi) {
      hi = lo + 1;
    }
    function px(i) {
      return pad + (n === 1 ? (width - pad * 2) / 2 : (i * (width - pad * 2)) / (n - 1));
    }
    function py(v) {
      return pad + (height - pad * 2) * (1 - (v - lo) / (hi - lo));
    }
    var points = [];
    for (var j = 0; j < n; j += 1) {
      if (isNum(values[j])) {
        points.push(px(j).toFixed(2) + "," + py(values[j]).toFixed(2));
      }
    }
    var out = open(opts.title || "Sparkline", width, height, opts.desc);
    out +=
      '<polyline points="' +
      points.join(" ") +
      '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />';
    return out + "</svg>";
  }

  var api = {
    barChart: barChart,
    divergingBarChart: divergingBarChart,
    lineChart: lineChart,
    heatmap: heatmap,
    pairedStepChart: pairedStepChart,
    bridgeChart: bridgeChart,
    sparkBars: sparkBars,
    sparkLine: sparkLine,
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
