/* "Follow the thousand": a Canvas2D picture of the funnel as six blocks.
 *
 * One square is one session in a thousand. Block i holds the sessions that
 * reached the step before it (block 0 holds all thousand); the bright squares
 * went on to reach block i's step, the muted ones stayed behind. The survivors
 * of each block travel on into the next. Every number is read from the canvas
 * data-* attributes, which the page renderer fills from the JSON at runtime.
 *
 * Browser-only. Runs once when the canvas scrolls into view; reduced motion
 * draws the finished picture straight away.
 */
(function (global) {
  "use strict";

  var DURATION = 2400;
  var GAP = 16;
  var LABEL_H = 64;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function ease(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (err) {
      return fallback;
    }
  }

  function hexToRgb(hex) {
    var v = String(hex || "").trim().replace("#", "");
    if (v.length === 3) {
      v = v.replace(/(.)/g, "$1$1");
    }
    if (!/^[0-9a-fA-F]{6}$/.test(v)) {
      return null;
    }
    var n = parseInt(v, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgba(c, a) {
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /* Cumulative per-1000 counts, forced to be non-increasing. */
  function cumulative(sessions, openRaw) {
    var cum = openRaw.map(function (v) {
      return Math.round((v / sessions) * 1000);
    });
    for (var i = 1; i < cum.length; i += 1) {
      cum[i] = Math.min(cum[i], cum[i - 1]);
    }
    return cum;
  }

  function wrap(ctx, text, maxW) {
    var words = String(text).split(" ");
    var lines = [];
    var line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (line && ctx.measureText(test).width > maxW) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    });
    if (line) {
      lines.push(line);
    }
    return lines;
  }

  function mount(canvas) {
    if (!canvas || typeof canvas.getContext !== "function") {
      return;
    }
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    var sessions = parseInt(canvas.getAttribute("data-sessions"), 10);
    var openRaw = String(canvas.getAttribute("data-open") || "")
      .split(",")
      .map(function (v) {
        return parseInt(v, 10);
      });
    var names = String(canvas.getAttribute("data-steps") || "").split("|");
    if (!(sessions > 0) || openRaw.length !== 6 || openRaw.some(function (v) { return !isFinite(v) || v < 0; })) {
      return;
    }
    var cum = cumulative(sessions, openRaw);
    /* Block i holds the sessions that reached step i-1 (all 1,000 for block 0). */
    var totals = cum.map(function (_, i) {
      return i === 0 ? 1000 : cum[i - 1];
    });
    var widths = totals.map(function (n) {
      return Math.max(3, Math.ceil(Math.sqrt(n)));
    });
    var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var colours = {};
    function readColours() {
      colours.accent = hexToRgb(cssVar("--accent", "#0b6b5e")) || { r: 11, g: 107, b: 94 };
      colours.ink = hexToRgb(cssVar("--ink", "#15171a")) || { r: 21, g: 23, b: 26 };
      colours.ink2 = hexToRgb(cssVar("--ink-2", "#4b5057")) || colours.ink;
      colours.lost = hexToRgb(cssVar("--lost", "#c8501e")) || { r: 200, g: 80, b: 30 };
      colours.font = cssVar("--font-mono", "monospace");
      colours.text = cssVar("--font-text", "sans-serif");
    }
    readColours();

    var L = null; /* layout */
    var frame = null;
    var started = false;
    var progress = 0;

    function layout() {
      var rect = canvas.getBoundingClientRect();
      var W = Math.round(rect.width) || canvas.clientWidth || 640;
      var rows = W >= 640 ? [[0, 1, 2, 3, 4, 5]] : [[0, 1], [2, 3], [4, 5]];
      var slotMin = W >= 640 ? 96 : 120;
      var pos = [];
      var y = 0;
      rows.forEach(function (row) {
        /* Largest cell size at which this row fits. */
        var cell;
        for (cell = 14; cell > 3; cell -= 0.5) {
          var sum = 0;
          row.forEach(function (i) {
            sum += Math.max(widths[i] * cell, slotMin);
          });
          if (sum + GAP * (row.length - 1) <= W) {
            break;
          }
        }
        var x = 0;
        var tallest = 0;
        row.forEach(function (i) {
          var h = Math.ceil(totals[i] / widths[i]);
          pos[i] = { x: x, y: y, w: widths[i], h: h, cell: cell, slot: Math.max(widths[i] * cell, slotMin) };
          x += pos[i].slot + GAP;
          tallest = Math.max(tallest, h * cell);
        });
        y += LABEL_H + tallest + (rows.length > 1 ? 44 : 24);
      });
      L = { W: W, H: Math.ceil(y), pos: pos };
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      canvas.width = Math.round(L.W * dpr);
      canvas.height = Math.round(L.H * dpr);
      canvas.style.height = L.H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function square(i, k) {
      var p = L.pos[i];
      return {
        x: p.x + (k % p.w) * p.cell,
        y: p.y + LABEL_H + Math.floor(k / p.w) * p.cell
      };
    }

    function box(x, y, size, radius) {
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, radius);
      } else {
        ctx.beginPath();
        ctx.rect(x, y, size, size);
      }
      ctx.fill();
    }

    function draw(t) {
      ctx.clearRect(0, 0, L.W, L.H);
      var muted = rgba(colours.ink, 0.16);
      var bright = rgba(colours.accent, 1);

      for (var i = 0; i < 6; i += 1) {
        var start = i * 0.12;
        var local = clamp((t - start) / 0.4, 0, 1);
        var e = ease(local);
        var p = L.pos[i];
        var size = p.cell * 0.78;
        var inset = (p.cell - size) / 2;
        var radius = Math.max(1, p.cell * 0.16);

        /* Block 0 appears at once; its bright squares light up as stage 0 runs. */
        for (var k = 0; k < totals[i]; k += 1) {
          var to = square(i, k);
          var x = to.x + inset;
          var y = to.y + inset;
          var survives = k < cum[i];
          if (i === 0) {
            ctx.fillStyle = survives && e > 0 ? bright : muted;
            if (survives && e > 0 && e < 1) {
              ctx.fillStyle = rgba(colours.accent, lerp(0.16, 1, e));
            }
          } else {
            if (local <= 0) {
              continue;
            }
            var from = square(i - 1, k);
            x = lerp(from.x, to.x, e) + inset;
            y = lerp(from.y, to.y, e) + inset;
            /* Those that stop here fade to muted as they land. */
            var settle = survives ? 1 : clamp((e - 0.55) / 0.45, 0, 1);
            ctx.fillStyle = survives ? bright : rgba(colours.accent, lerp(1, 0.2, settle));
            if (!survives && settle >= 1) {
              ctx.fillStyle = muted;
            }
          }
          box(x, y, size, radius);
        }

        /* Labels: count per 1,000, then the step name. */
        var labelOn = i === 0 || local > 0;
        ctx.globalAlpha = labelOn ? 1 : 0;
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = rgba(colours.accent, 1);
        ctx.font = "600 22px " + colours.font;
        ctx.fillText(String(cum[i]), p.x, p.y + 22);
        ctx.fillStyle = rgba(colours.ink, 1);
        ctx.font = "500 13px " + colours.text;
        wrap(ctx, names[i] || "", p.slot).forEach(function (line, n) {
          ctx.fillText(line, p.x, p.y + 42 + n * 15);
        });
        var left = totals[i] - cum[i];
        if (left > 0 && local >= 1) {
          ctx.fillStyle = rgba(colours.lost, 1);
          ctx.font = "500 12px " + colours.font;
          ctx.fillText("\u2212" + left + " stop here", p.x, p.y + LABEL_H + p.h * p.cell + 18);
        }
        ctx.globalAlpha = 1;
      }
    }

    function render(t) {
      layout();
      progress = t;
      draw(t);
    }

    function run() {
      var t0 = null;
      function step(now) {
        if (t0 === null) {
          t0 = now;
        }
        progress = clamp((now - t0) / DURATION, 0, 1);
        draw(progress);
        frame = progress < 1 ? global.requestAnimationFrame(step) : null;
      }
      frame = global.requestAnimationFrame(step);
    }

    function start() {
      if (started) {
        return;
      }
      started = true;
      if (reduced || typeof global.requestAnimationFrame !== "function") {
        render(1);
      } else {
        run();
      }
    }

    var timer = null;
    global.addEventListener("resize", function () {
      global.clearTimeout(timer);
      timer = global.setTimeout(function () {
        if (frame) {
          global.cancelAnimationFrame(frame);
          frame = null;
        }
        render(started ? 1 : 0);
      }, 150);
    });

    /* Re-read the colours when the theme changes. */
    function recolour() {
      readColours();
      if (L && !frame) {
        draw(progress);
      }
    }
    if (typeof MutationObserver === "function") {
      new MutationObserver(recolour).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "class", "style"]
      });
    }
    if (global.matchMedia) {
      var mq = global.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) {
        mq.addEventListener("change", recolour);
      }
    }

    if (reduced) {
      start();
      return;
    }
    render(0);
    if (typeof global.IntersectionObserver === "function") {
      var observer = new global.IntersectionObserver(function (entries) {
        if (entries.some(function (en) { return en.isIntersecting; })) {
          observer.disconnect();
          start();
        }
      });
      observer.observe(canvas);
    } else {
      start();
    }
  }

  var api = { mount: mount };
  if (typeof window !== "undefined") {
    window.Hero = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
