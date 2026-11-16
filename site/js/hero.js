/* "Follow the thousand": a Canvas2D field of 1,000 squares.
 *
 * One square is one session in a thousand. The squares are sorted by how far
 * each session got: a wide dim field of the sessions that never viewed an item,
 * then six small blocks, one per funnel step, ending with the sessions that
 * buy. Every number is read from the canvas data-* attributes, which the page
 * renderer fills from the JSON at runtime.
 *
 * The module is browser-only. It runs the sort once when the canvas scrolls
 * into view and draws the finished picture straight away when the reader asks
 * for reduced motion.
 */
(function (global) {
  "use strict";

  var COLS = 40;
  var START_ROWS = 25; /* 40 x 25 = 1,000 */
  var DURATION = 1900;
  /* Draw order: most advanced first, so purchasers sit top-left. */
  var ORDER = [5, 4, 3, 2, 1, 0, -1];
  /* Stagger, as a share of DURATION, keyed by group (-1 is "never viewed"). */
  var DELAY = { "-1": 0, 0: 0.06, 1: 0.12, 2: 0.16, 3: 0.2, 4: 0.26, 5: 0.34 };
  /* Alpha ramp from a faint view to a solid purchase. */
  var ALPHA = { 0: 0.22, 1: 0.4, 2: 0.54, 3: 0.68, 4: 0.84, 5: 1 };

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function cssVar(name) {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    } catch (err) {
      return "";
    }
  }

  function hexToRgb(hex) {
    var value = String(hex || "").trim();
    if (value.charAt(0) === "#") {
      value = value.slice(1);
    }
    if (value.length === 3) {
      value = value
        .split("")
        .map(function (c) {
          return c + c;
        })
        .join("");
    }
    if (!/^[0-9a-fA-F]{6}$/.test(value)) {
      return null;
    }
    var n = parseInt(value, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgba(c, a) {
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }

  function mix(a, b, t) {
    return {
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t),
      a: a.a + (b.a - a.a) * t
    };
  }

  /* The disjoint per-1000 counts for the six steps plus "never viewed". */
  function groupsFor(sessions, openRaw) {
    var cum = openRaw.map(function (value) {
      return Math.round((value / sessions) * 1000);
    });
    for (var i = 1; i < cum.length; i += 1) {
      if (cum[i] > cum[i - 1]) {
        cum[i] = cum[i - 1];
      }
      cum[i] = Math.max(0, cum[i]);
    }
    var counts = [];
    for (i = 0; i < 6; i += 1) {
      var next = i < 5 ? cum[i + 1] : 0;
      counts.push(Math.max(0, cum[i] - next));
    }
    var seen = counts.reduce(function (sum, value) {
      return sum + value;
    }, 0);
    var never = clamp(1000 - seen, 0, 1000);
    if (seen + never !== 1000) {
      never += 1000 - (seen + never);
    }
    return { counts: counts, never: never };
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
      .map(function (value) {
        return parseInt(value, 10);
      });
    if (
      !(sessions > 0) ||
      openRaw.length !== 6 ||
      openRaw.some(function (value) {
        return !isFinite(value) || value < 0;
      })
    ) {
      return;
    }

    var accent = hexToRgb(cssVar("--accent")) || { r: 11, g: 107, b: 94 };
    var ink = hexToRgb(cssVar("--ink")) || { r: 21, g: 23, b: 26 };
    var reduced =
      global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var groups = groupsFor(sessions, openRaw);

    /* Build the squares in draw order and lay out the finished picture. */
    var squares = [];
    ORDER.forEach(function (group) {
      var count = group === -1 ? groups.never : groups.counts[group];
      for (var c = 0; c < count; c += 1) {
        var target =
          group === -1
            ? { r: ink.r, g: ink.g, b: ink.b, a: 0.1 }
            : { r: accent.r, g: accent.g, b: accent.b, a: ALPHA[group] };
        squares.push({
          group: group,
          delay: DELAY[String(group)] || 0,
          start: { r: ink.r, g: ink.g, b: ink.b, a: 0.06 },
          target: target
        });
      }
    });

    var byGroup = {};
    ORDER.forEach(function (group) {
      byGroup[group] = [];
    });
    squares.forEach(function (square) {
      byGroup[square.group].push(square);
    });

    var row = 0;
    var col = 0;
    ORDER.forEach(function (group) {
      var list = byGroup[group];
      if (!list.length) {
        return;
      }
      if (col !== 0) {
        row += 1;
        col = 0;
      }
      list.forEach(function (square) {
        square.fcol = col;
        square.frow = row;
        col += 1;
        if (col >= COLS) {
          col = 0;
          row += 1;
        }
      });
    });
    var rows = row + (col > 0 ? 1 : 0);
    var maxRows = Math.max(rows, START_ROWS);
    squares.forEach(function (square, index) {
      square.scol = index % COLS;
      square.srow = Math.floor(index / COLS);
    });

    var width = 0;
    var height = 0;
    var frame = null;
    var started = false;

    function measure() {
      var rect = canvas.getBoundingClientRect();
      var cssWidth = Math.round(rect.width) || canvas.clientWidth || 640;
      var cssHeight = Math.round((cssWidth * maxRows) / COLS);
      width = cssWidth;
      height = Math.max(120, cssHeight);
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(progress) {
      ctx.clearRect(0, 0, width, height);
      var cell = Math.min(width / COLS, height / maxRows);
      var size = cell * 0.8;
      var radius = Math.max(1, cell * 0.18);
      var gridW = COLS * cell;
      var gridH = rows * cell;
      var startH = START_ROWS * cell;
      var offX = (width - gridW) / 2;
      var offY = (height - gridH) / 2;
      var startOffY = (height - startH) / 2;

      for (var i = 0; i < squares.length; i += 1) {
        var square = squares[i];
        var span = 1 - square.delay;
        var local = span > 0 ? clamp((progress - square.delay) / span, 0, 1) : 1;
        var t = easeOutCubic(local);
        var sx = offX + square.scol * cell + (cell - size) / 2;
        var sy = startOffY + square.srow * cell + (cell - size) / 2;
        var fx = offX + square.fcol * cell + (cell - size) / 2;
        var fy = offY + square.frow * cell + (cell - size) / 2;
        var x = sx + (fx - sx) * t;
        var y = sy + (fy - sy) * t;
        var colour = mix(square.start, square.target, t);
        ctx.fillStyle = rgba(colour, colour.a);
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x, y, size, size, radius);
        } else {
          ctx.rect(x, y, size, size);
        }
        ctx.fill();
      }
    }

    function render(progress) {
      measure();
      draw(progress);
    }

    function animate() {
      var startTime = null;
      function step(now) {
        if (startTime === null) {
          startTime = now;
        }
        var progress = clamp((now - startTime) / DURATION, 0, 1);
        draw(progress);
        if (progress < 1) {
          frame = global.requestAnimationFrame(step);
        } else {
          frame = null;
        }
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
        return;
      }
      animate();
    }

    var resizeTimer = null;
    global.addEventListener("resize", function () {
      if (resizeTimer) {
        global.clearTimeout(resizeTimer);
      }
      resizeTimer = global.setTimeout(function () {
        if (frame) {
          global.cancelAnimationFrame(frame);
          frame = null;
        }
        if (started) {
          render(1);
        } else {
          measure();
          draw(reduced ? 1 : 0);
        }
      }, 150);
    });

    if (reduced) {
      start();
      return;
    }

    if (typeof global.IntersectionObserver === "function") {
      var observer = new global.IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i += 1) {
          if (entries[i].isIntersecting) {
            observer.disconnect();
            start();
            return;
          }
        }
      });
      observer.observe(canvas);
      /* Draw the unsorted field while the reader scrolls toward it. */
      render(0);
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
