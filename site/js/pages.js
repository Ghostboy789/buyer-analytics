/* Pure page renderers for the Buyer Analytics site.
 *
 * One function per page. Each takes the parsed JSON artefact(s) and returns an
 * HTML string; nothing touches the DOM, so the functions can be called from
 * Node for testing. Chart and number formatting come from charts.js and the
 * glossary from glossary.js, both loaded either from the page (window.*) or
 * with require() under Node.
 */
(function (global) {
  "use strict";

  var C =
    typeof module !== "undefined" && module.exports
      ? require("./charts.js")
      : global.Charts;
  var G =
    typeof module !== "undefined" && module.exports
      ? require("./glossary.js")
      : global.Glossary;

  var DASH = "\u2014";

  var STORY = [
    { page: "index", label: "Overview" },
    { page: "funnel", label: "Funnel" },
    { page: "cohorts", label: "Cohorts" },
    { page: "revenue", label: "Revenue" },
    { page: "experiments", label: "Experiments" },
    { page: "quality", label: "Data quality" },
    { page: "lab", label: "Experiment lab" }
  ];

  function esc(value) {
    return C.escape(value);
  }

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  function pct(value) {
    return C.formatPct(value);
  }

  /* A glossary term: a real button that drives one shared popover. */
  function term(key, label) {
    return (
      '<button type="button" class="term" data-term="' +
      esc(key) +
      '" aria-expanded="false" aria-controls="glossary-pop" aria-describedby="glossary-pop">' +
      esc(label) +
      "</button>"
    );
  }

  function note(text) {
    return '<p class="note">' + text + "</p>";
  }

  function section(id, title, body, extraClass) {
    return (
      '<section class="section ' +
      (extraClass || "") +
      '"' +
      (id ? ' id="' + esc(id) + '"' : "") +
      ">" +
      (title ? '<h2 class="section-head">' + title + "</h2>" : "") +
      body +
      "</section>"
    );
  }

  function details(summary, body) {
    return (
      '<details class="data-toggle"><summary>' +
      esc(summary) +
      "</summary>" +
      body +
      "</details>"
    );
  }

  function card(title, body, extraClass) {
    return (
      '<section class="card ' +
      (extraClass || "") +
      '">' +
      (title ? '<h3 class="card-title">' + title + "</h3>" : "") +
      body +
      "</section>"
    );
  }

  function chartCard(title, chart, meaning, table) {
    return card(
      title,
      '<div class="chart-wrap" tabindex="0" role="group" aria-label="Chart (scrolls sideways on narrow screens)">' +
        chart +
        "</div>" +
        (meaning ? '<p class="meaning"><span class="meaning-label">What this means</span> ' + meaning + "</p>" : "") +
        (table ? details("Exact numbers", table) : "")
    );
  }

  function table(headers, rows, opts) {
    opts = opts || {};
    var out = '<div class="table-wrap"><table' + (opts.cls ? ' class="' + opts.cls + '"' : "") + "><thead><tr>";
    for (var h = 0; h < headers.length; h += 1) {
      out += '<th scope="col"' + (h > 0 ? ' class="num"' : "") + ">" + esc(headers[h]) + "</th>";
    }
    out += "</tr></thead><tbody>";
    for (var r = 0; r < rows.length; r += 1) {
      out += "<tr>";
      for (var c = 0; c < rows[r].length; c += 1) {
        out +=
          (c === 0 ? '<th scope="row">' : '<td class="num">') +
          rows[r][c] +
          (c === 0 ? "</th>" : "</td>");
      }
      out += "</tr>";
    }
    return out + "</tbody></table></div>";
  }

  function dl(pairs) {
    return (
      '<dl class="kv">' +
      pairs
        .map(function (pair) {
          return "<dt>" + esc(pair[0]) + "</dt><dd>" + pair[1] + "</dd>";
        })
        .join("") +
      "</dl>"
    );
  }

  function intervalBar(num, kind) {
    if (!num || !isNum(num.ci_low) || !isNum(num.ci_high)) {
      return "";
    }
    var lo = Math.min(num.ci_low, 0);
    var hi = Math.max(num.ci_high, num.value) * 1.08;
    var span = hi - lo || 1;
    function clamp(v) {
      return Math.max(0, Math.min(100, v));
    }
    var left = clamp(((num.ci_low - lo) / span) * 100);
    var width = clamp(((num.ci_high - num.ci_low) / span) * 100);
    var dot = clamp(((num.value - lo) / span) * 100);
    var label =
      "Estimate " +
      C.formatValue(num.value, kind) +
      ". 95% interval " +
      C.formatValue(num.ci_low, kind) +
      " to " +
      C.formatValue(num.ci_high, kind) +
      ". n equals " +
      C.formatInt(num.n) +
      ".";
    return (
      '<div class="ivbar" role="img" aria-label="' +
      esc(label) +
      '"><span class="ivbar-track"></span><span class="ivbar-range" style="left:' +
      left.toFixed(2) +
      "%;width:" +
      width.toFixed(2) +
      '%"></span><span class="ivbar-dot" style="left:' +
      dot.toFixed(2) +
      '%"></span></div>'
    );
  }

  function kpiEstimate(label, num, kind) {
    return (
      '<div class="kpi"><div class="kpi-label">' +
      esc(label) +
      '</div><div class="kpi-value">' +
      C.formatValue(num.value, kind) +
      "</div>" +
      intervalBar(num, kind) +
      '<div class="kpi-ci">' +
      esc(C.numDetail(num, kind)) +
      "</div></div>"
    );
  }

  function kpiExact(label, value) {
    return (
      '<div class="kpi"><div class="kpi-label">' +
      esc(label) +
      '</div><div class="kpi-value">' +
      value +
      '</div><div class="kpi-ci">exact count</div></div>'
    );
  }

  function badge(ok) {
    return (
      '<span class="badge ' +
      (ok ? "badge-pass" : "badge-fail") +
      '"><span class="badge-dot" aria-hidden="true"></span>' +
      (ok ? "PASS" : "FAIL") +
      "</span>"
    );
  }

  function bigStat(label, num, kind, sub) {
    return (
      '<div class="bigstat"><div class="bigstat-label">' +
      esc(label) +
      '</div><div class="bigstat-value">' +
      C.formatValue(num.value, kind) +
      "</div>" +
      intervalBar(num, kind) +
      '<div class="bigstat-ci">' +
      esc(C.numDetail(num, kind)) +
      "</div>" +
      (sub ? '<div class="bigstat-sub">' + sub + "</div>" : "") +
      "</div>"
    );
  }

  function prettyStep(step) {
    var parts = String(step).split("_");
    parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    return parts.join(" ");
  }

  function prettyMetric(metric) {
    return String(metric).split("_").join(" ");
  }

  function prettyChannel(channel) {
    return String(channel).split("_").join(" ");
  }

  function formatP(value) {
    if (!isNum(value)) {
      return DASH;
    }
    if (value < 0.0001) {
      return "< 0.0001";
    }
    return value.toFixed(4);
  }

  function pageHead(eyebrow, headline, look) {
    return (
      '<header class="page-head" data-reveal>' +
      '<p class="eyebrow">' +
      esc(eyebrow) +
      '</p><h1 class="display">' +
      headline +
      "</h1>" +
      (look ? '<p class="page-sub">' + look + "</p>" : "") +
      "</header>"
    );
  }

  function nextCard(page) {
    var index = 0;
    for (var i = 0; i < STORY.length; i += 1) {
      if (STORY[i].page === page) {
        index = i;
      }
    }
    var next = STORY[(index + 1) % STORY.length];
    return (
      '<nav class="next-card" aria-label="Next page"><a href="' +
      next.page +
      '.html"><span class="next-label">Next</span><span class="next-title">' +
      esc(next.label) +
      '</span><span class="next-arrow" aria-hidden="true">\u2192</span></a></nav>'
    );
  }

  function renderFooter(desc) {
    var meta = (desc && desc.meta) || {};
    var range =
      meta.date_min && meta.date_max
        ? "Data range " + esc(meta.date_min) + " to " + esc(meta.date_max) + "."
        : "Data range unavailable.";
    return (
      '<div class="footer-grid">' +
      '<p class="footer-credit">Source: the public Google Merchandise Store GA4 sample, used for non-commercial analysis. ' +
      range +
      "</p>" +
      '<p class="footer-note">A &ldquo;user&rdquo; in every figure on this site is a browser cookie, not a person.</p>' +
      '<p class="footer-link"><a href="https://github.com/Ghostboy789/buyer-analytics">Repository</a></p>' +
      "</div>"
    );
  }

  /* ------------------------------------------------------------------ */
  /* Overview                                                            */
  /* ------------------------------------------------------------------ */

  function renderOverview(desc, decomp, exp) {
    var k = desc.kpis;
    var weeks = desc.weekly;
    var f = desc.funnel;
    var overall = f.overall;
    var steps = f.steps;
    var sessions = k.sessions;
    var openPer1000 = overall.open_reached.map(function (count) {
      return Math.round((count / sessions) * 1000);
    });
    var nBuy = Math.round(k.session_conversion.value * 1000);

    var heroTable = table(
      ["Funnel step", "Sessions with the event", "Per 1,000 sessions"],
      steps.map(function (step, i) {
        return [
          esc(prettyStep(step)),
          C.formatInt(overall.open_reached[i]),
          C.formatInt(openPer1000[i])
        ];
      })
    );

    var hero =
      '<section class="hero">' +
      '<div class="hero-copy" data-reveal>' +
      '<p class="eyebrow">Overview</p>' +
      '<h1 class="display hero-headline">Of every 1,000 <span class="nowrap">' +
      term("session", "sessions") +
      ',</span> <span class="hero-num">' +
      nBuy +
      "</span> buy.</h1>" +
      '<p class="hero-sub">A ' +
      term("conversion", "session conversion") +
      " of " +
      C.formatValue(k.session_conversion.value, "rate") +
      " (95% interval " +
      C.formatValue(k.session_conversion.ci_low, "rate") +
      " to " +
      C.formatValue(k.session_conversion.ci_high, "rate") +
      ", n = " +
      C.formatInt(k.session_conversion.n) +
      ").</p>" +
      '<p class="hero-look">Each square is one session in a thousand. Read the blocks left to right: the bright squares reached that step, the muted ones dropped out on the way.</p>' +
      "</div>" +
      '<div class="hero-visual card" data-reveal>' +
      '<canvas class="hero-canvas" data-hero role="img" aria-label="Six blocks of squares, one per funnel step, each square a session in a thousand. ' +
      nBuy +
      ' of the thousand reach the purchase step; most never view an item." data-sessions="' +
      sessions +
      '" data-open="' +
      overall.open_reached.join(",") +
      '" data-steps="' +
      esc(
        steps
          .map(function (step) {
            return prettyStep(step);
          })
          .join("|")
      ) +
      '" data-purchase="' +
      nBuy +
      '"></canvas>' +
      '<p class="hero-caption">Each block redraws the sessions that reached the one before it.</p>' +
      details("Exact numbers", heroTable) +
      "</div>" +
      "</section>";

    /* Bento: one card per finding. */
    var channelTop = desc.channels.slice().sort(function (a, b) {
      return b.user_conversion.value - a.user_conversion.value;
    })[0];
    var firstCohort = desc.cohorts[0];
    var week1 = null;
    firstCohort.retention.forEach(function (point) {
      if (point.week_offset === 1) {
        week1 = point.rate;
      }
    });
    var cmp23 = null;
    var cmp12 = null;
    (decomp.comparisons || []).forEach(function (cmp) {
      if (cmp.from === "P2" && cmp.to === "P3") {
        cmp23 = cmp;
      }
      if (cmp.from === "P1" && cmp.to === "P2") {
        cmp12 = cmp;
      }
    });

    var bento = [
      {
        page: "funnel",
        kicker: "Funnel",
        title: "Most sessions stop before the cart",
        num: C.formatPct(overall.rate_from_prev[1].value) + " of item views reach the cart",
        chart: C.sparkBars(overall.open_reached, {
          title: "Sessions with each funnel event",
          highlight: 5
        }),
        link: "Where the drop happens"
      },
      {
        page: "funnel",
        kicker: "Devices and channels",
        title: "Referral users buy a little more often",
        num:
          C.formatPct(channelTop.user_conversion.value) +
          " user conversion, " +
          esc(prettyChannel(channelTop.channel)),
        chart: C.sparkBars(
          desc.channels.map(function (c) {
            return c.user_conversion.value;
          }),
          { title: "User conversion by first-touch channel" }
        ),
        link: "Compare the segments"
      },
      {
        page: "cohorts",
        kicker: "Retention",
        title: "Few users come back the next week",
        num: week1 ? C.formatPct(week1.value) + " return in week 1" : DASH,
        chart: C.sparkLine(
          firstCohort.retention.map(function (point) {
            return point.rate.value;
          }),
          { title: "Weekly retention of the first cohort" }
        ),
        link: "See the retention grid"
      },
      {
        page: "revenue",
        kicker: "Revenue",
        title: "The January fall was mostly conversion",
        num: cmp23
          ? C.formatMoney(Math.abs(cmp23.delta_revenue_usd)) + " lost from P2 to P3"
          : DASH,
        chart: C.sparkBars(
          weeks.map(function (w) {
            return w.revenue_usd;
          }),
          { title: "Revenue by week" }
        ),
        link: "Where the revenue went"
      },
      {
        page: "experiments",
        kicker: "Experiments",
        title: "Checking a test every day would fool you often",
        num: exp
          ? C.formatPct(exp.peeking.fpr_naive_peeking.value) +
            " false wins when peeking, " +
            C.formatPct(exp.peeking.fpr_fixed_horizon.value) +
            " when tested once"
          : "Every effect is planted, on real traffic",
        chart: exp
          ? C.sparkBars(
              [
                exp.peeking.fpr_fixed_horizon.value,
                exp.peeking.fpr_sequential.value,
                exp.peeking.fpr_naive_peeking.value
              ],
              { title: "False-positive rate by testing rule", highlight: 2 }
            )
          : "",
        link: "See the peeking trap"
      }
    ];

    var bentoHtml =
      '<section class="section bento-section"><h2 class="section-head">Five things the thousand shows</h2>' +
      '<div class="bento">' +
      bento
        .map(function (item) {
          return (
            '<a class="bento-card" href="' +
            item.page +
            '.html" data-reveal>' +
            '<p class="bento-kicker">' +
            esc(item.kicker) +
            "</p>" +
            '<h3 class="bento-title">' +
            esc(item.title) +
            "</h3>" +
            '<p class="bento-num">' +
            item.num +
            "</p>" +
            '<div class="bento-chart">' +
            item.chart +
            "</div>" +
            '<span class="bento-link">' +
            esc(item.link) +
            ' <span aria-hidden="true">\u2192</span></span>' +
            "</a>"
          );
        })
        .join("") +
      "</div></section>";

    var readFirst =
      '<ul class="note-list">' +
      '<li>One browser cookie is one ' +
      term("user", "user") +
      ". User counts are cookie counts, not people, and cross-device behaviour cannot be joined because the user id is always empty.</li>" +
      "<li>Channel is the first-touch source of the user, fixed when the user first arrives. It is not the source of each session and it is not last-click attribution.</li>" +
      "<li>The period runs from " +
      esc(desc.meta.date_min) +
      " to " +
      esc(desc.meta.date_max) +
      " and includes Black Friday and Christmas.</li>" +
      "<li>The data contains no real experiment. The experiments page is a method check on real traffic, and every effect there is planted.</li>" +
      "</ul>";

    var labels = weeks.map(function (w) {
      return w.week_start;
    });
    var sessionsChart = C.lineChart(
      [
        {
          name: "Sessions",
          values: weeks.map(function (w) {
            return w.sessions;
          })
        }
      ],
      {
        title: "Weekly sessions",
        desc: "Sessions per week from " + desc.meta.date_min + " to " + desc.meta.date_max + ".",
        xLabels: labels,
        format: function (v) {
          return C.formatInt(v);
        }
      }
    );
    var sessionsTable = table(
      ["Week", "Sessions"],
      weeks.map(function (w) {
        return [esc(w.week_start), C.formatInt(w.sessions)];
      })
    );

    var revenueChart = C.lineChart(
      [
        {
          name: "Revenue",
          values: weeks.map(function (w) {
            return w.revenue_usd;
          })
        }
      ],
      {
        title: "Weekly revenue",
        xLabels: labels,
        format: function (v) {
          return C.formatMoney(v);
        }
      }
    );
    var revenueTable = table(
      ["Week", "Revenue"],
      weeks.map(function (w) {
        return [esc(w.week_start), C.formatMoney(w.revenue_usd)];
      })
    );

    var conversionChart = C.lineChart(
      [
        {
          name: "Session conversion",
          values: weeks.map(function (w) {
            return w.session_conversion.value;
          })
        }
      ],
      {
        title: "Weekly session conversion with its 95% interval",
        xLabels: labels,
        format: function (v) {
          return C.formatPct(v);
        },
        band: {
          low: weeks.map(function (w) {
            return w.session_conversion.ci_low;
          }),
          high: weeks.map(function (w) {
            return w.session_conversion.ci_high;
          })
        }
      }
    );
    var conversionTable = table(
      ["Week", "Session conversion"],
      weeks.map(function (w) {
        return [esc(w.week_start), C.formatNum(w.session_conversion, "rate")];
      })
    );

    var out = hero;
    out += section(
      "numbers",
      "The store in numbers",
      '<div class="kpi-grid">' +
        kpiExact("Sessions", C.formatInt(k.sessions)) +
        kpiExact("Users (cookies)", C.formatInt(k.users)) +
        kpiExact("Orders", C.formatInt(k.orders)) +
        kpiExact("Revenue", C.formatMoney(k.revenue_usd)) +
        kpiEstimate("Session conversion", k.session_conversion, "rate") +
        kpiEstimate("User conversion", k.user_conversion, "rate") +
        kpiEstimate("AOV", k.aov, "money") +
        kpiEstimate("Revenue per user", k.revenue_per_user, "money") +
        kpiEstimate("Items per order", k.items_per_order, "number") +
        kpiEstimate("Zero-revenue orders", k.zero_revenue_order_share, "rate") +
        "</div>"
    );
    out += bentoHtml;
    out += section("read", "Read this first", card("", readFirst));
    out += section(
      "weekly",
      "The weeks",
      '<div class="chart-grid">' +
        chartCard("Sessions", sessionsChart, "Traffic climbs into the holidays, peaks in the first week of December, then falls back.", sessionsTable) +
        chartCard("Revenue", revenueChart, "Revenue follows traffic, but falls faster than traffic after the holidays.", revenueTable) +
        chartCard("Session conversion", conversionChart, "Each week's conversion with its 95% interval; the shaded band is the interval, not a trend.", conversionTable) +
        "</div>"
    );
    out += nextCard("index");
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Funnel                                                              */
  /* ------------------------------------------------------------------ */

  function renderFunnel(desc) {
    var f = desc.funnel;
    var steps = f.steps;
    var overall = f.overall;
    var last = steps.length - 1;
    var out = "";

    var firstDrop = 1 - overall.rate_from_prev[1].value;
    var headline =
      "The largest loss is before the cart: " +
      '<span class="hl">' +
      C.formatPct(firstDrop) +
      "</span> of sessions that view an item never add one.";
    out += pageHead(
      "Conversion path",
      headline,
      "Two funnels are drawn together: the closed funnel needs every earlier step in the same session, the open funnel only needs the step's own event."
    );

    var pairedRows = steps.map(function (step, index) {
      return {
        label: prettyStep(step),
        closed: overall.reached[index],
        open: overall.open_reached[index]
      };
    });
    var paired = C.pairedStepChart(pairedRows, {
      title: "Closed and open funnel counts per step",
      desc: "For each step, the closed count needs every earlier step in the same session; the open count only needs the step event.",
      format: C.formatInt
    });
    var funnelTable = table(
      [
        "Step",
        "Closed: sessions reaching",
        "Open: sessions with the event",
        "From all sessions (closed)",
        "From previous step (closed)"
      ],
      steps.map(function (step, index) {
        return [
          esc(prettyStep(step)),
          C.formatInt(overall.reached[index]),
          C.formatInt(overall.open_reached[index]),
          C.formatNum(overall.rate_from_sessions[index], "rate"),
          C.formatNum(overall.rate_from_prev[index], "rate")
        ];
      })
    );
    out += section(
      "overall",
      "Closed and open funnels",
      chartCard(
        "Sessions reaching each step",
        paired,
        "The closed funnel can only fall from step to step. The open funnel is higher because a cart or checkout can start in an earlier session, so the later session has the event without the earlier ones.",
        funnelTable
      )
    );

    function purchaseRows(blockMap) {
      return Object.keys(blockMap)
        .map(function (name) {
          var block = blockMap[name];
          var rate = block.rate_from_sessions[last];
          return {
            label: name,
            value: rate.value,
            ci_low: rate.ci_low,
            ci_high: rate.ci_high,
            n: rate.n,
            sessions: block.sessions,
            reached: block.reached[last]
          };
        })
        .sort(function (a, b) {
          return b.value - a.value;
        });
    }

    function segmentCard(title, blockMap, meaning) {
      var data = purchaseRows(blockMap);
      var chart = C.barChart(
        data.map(function (row) {
          return {
            label: row.label,
            value: row.value,
            ci_low: row.ci_low,
            ci_high: row.ci_high
          };
        }),
        {
          title: title,
          format: function (v) {
            return C.formatPct(v);
          }
        }
      );
      var rows = data.map(function (row) {
        return [
          esc(row.label),
          C.formatInt(row.reached),
          C.formatInt(row.sessions),
          C.formatNum(
            { value: row.value, ci_low: row.ci_low, ci_high: row.ci_high, n: row.n },
            "rate"
          )
        ];
      });
      return chartCard(
        title,
        chart,
        meaning,
        table(["Segment", "Purchases", "Sessions", "Purchase rate"], rows)
      );
    }

    out += section(
      "segments",
      "Purchase rate from sessions",
      '<div class="chart-grid">' +
        segmentCard("By device", f.by_device, "Mobile and desktop land in almost the same place; the intervals overlap.") +
        segmentCard("By channel", f.by_channel, "Referral and undisclosed-source users buy a little more often than the rest.") +
        segmentCard("By country group", f.by_country, "Country groups are the five biggest by sessions plus everything else.") +
        "</div>"
    );

    var skipped = f.skipped_step_share;
    out += section(
      "skipped",
      "Sessions that skip a step",
      card(
        "",
        '<div class="bigstat-row"><div class="bigstat"><div class="bigstat-label">Purchasing sessions that skip an earlier step</div><div class="bigstat-value">' +
          C.formatValue(skipped.value, "rate") +
          "</div>" +
          intervalBar(skipped, "rate") +
          '<div class="bigstat-ci">' +
          esc(C.numDetail(skipped, "rate")) +
          "</div></div></div>" +
          note(
            "This is the share of purchasing sessions with a purchase event that skipped at least one earlier closed-funnel step. A purchase can be logged without every earlier step being recorded first, so the closed funnel is a lower bound on each step."
          )
      )
    );

    var tests = desc.segment_tests.filter(function (test) {
      return test.page === "funnel";
    });
    var testTable = table(
      ["Comparison", "Metric", "Difference", "Raw p", "Holm p", "Verdict"],
      tests.map(function (test) {
        return [
          esc(test.a + " vs " + test.b),
          esc(prettyMetric(test.metric)),
          C.formatPct(test.diff),
          formatP(test.p_raw),
          formatP(test.p_holm),
          badge(test.p_holm < 0.05)
        ];
      })
    );
    out += section(
      "tests",
      "Segment tests",
      chartCard(
        "Do the segments differ?",
        '<p class="prose">' +
          "Two-proportion tests with " +
          term("holm", "Holm's correction") +
          " across the comparisons on this page. A small Holm p means the two segments differ.</p>" +
          testTable,
        "",
        ""
      )
    );
    out += nextCard("funnel");
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Cohorts                                                             */
  /* ------------------------------------------------------------------ */

  function renderCohorts(desc) {
    var cohorts = desc.cohorts;
    var maxOffset = 0;
    var maxRet = 0;
    cohorts.forEach(function (cohort) {
      cohort.retention.forEach(function (point) {
        if (point.week_offset > maxOffset) {
          maxOffset = point.week_offset;
        }
        if (point.week_offset >= 1 && point.rate.value > maxRet) {
          maxRet = point.rate.value;
        }
      });
    });
    if (!(maxRet > 0)) {
      maxRet = 1;
    }

    var firstWeek1 = null;
    cohorts[0].retention.forEach(function (point) {
      if (point.week_offset === 1) {
        firstWeek1 = point.rate;
      }
    });
    var lastWeek1 = null;
    cohorts[cohorts.length - 1].retention.forEach(function (point) {
      if (point.week_offset === 1) {
        lastWeek1 = point.rate;
      }
    });

    var headline =
      "Few users come back: " +
      '<span class="hl">' +
      (firstWeek1 ? C.formatPct(firstWeek1.value) : DASH) +
      "</span> of the first cohort are active the next week" +
      (lastWeek1 ? ", falling to " + C.formatPct(lastWeek1.value) + " by " + esc(cohorts[cohorts.length - 1].cohort_week) : "") +
      ".";
    var out = pageHead(
      "Retention",
      headline,
      "Each row is a cohort week; each column is a week after the first visit. Read the grid left to right to watch a cohort fade."
    );

    var head = '<tr><th scope="col" class="heat-rowhead">Cohort week</th><th scope="col" class="num">Users</th>';
    for (var i = 0; i <= maxOffset; i += 1) {
      head += '<th scope="col" class="num">W' + i + "</th>";
    }
    head += "</tr>";
    var body = cohorts
      .map(function (cohort) {
        var cells = '<th scope="row" class="heat-rowhead">' + esc(cohort.cohort_week) + "</th>";
        cells += '<td class="num">' + C.formatInt(cohort.cohort_users) + "</td>";
        for (var j = 0; j <= maxOffset; j += 1) {
          var point = null;
          cohort.retention.forEach(function (p) {
            if (p.week_offset === j) {
              point = p;
            }
          });
          if (!point) {
            cells += '<td class="heat-cell heat-empty">' + DASH + "</td>";
          } else if (j === 0) {
            cells += '<td class="heat-cell heat-base">100%</td>';
          } else {
            var ratio = point.rate.value / maxRet;
            var step = Math.min(5, Math.max(0, Math.round(ratio * 5)));
            cells +=
              '<td class="heat-cell heat-' +
              step +
              '">' +
              C.formatPct(point.rate.value, 1) +
              "</td>";
          }
        }
        return "<tr>" + cells + "</tr>";
      })
      .join("");

    var heat =
      '<div class="heat-scroll" tabindex="0" role="region" aria-label="Retention heatmap, scrolls horizontally"><table class="heat-table"><thead>' +
      head +
      "</thead><tbody>" +
      body +
      "</tbody></table></div>";

    out += section(
      "retention",
      "Retention by cohort",
      card(
        "Share of each cohort active again in each week",
        heat +
          note(
            "Each row is a cohort week, the Monday of a user's first event. Each column is weeks after that first week. The value is the share of the cohort with at least one " +
              term("session", "session") +
              " in that week; only fully observed cells are shown. The grid scrolls sideways on a phone."
          )
      )
    );

    var rep = desc.repeat;
    out += section(
      "repeat",
      "Repeat purchase",
      card(
        "",
        table(
          ["Metric", "Estimate"],
          [
            ["Repeat purchase within 28 days", C.formatNum(rep.repeat_28d, "rate")],
            [
              "Median days to second order",
              C.formatNum(rep.median_days_to_second, "number")
            ]
          ]
        ) +
          note(
            "The repeat rate is measured among buyers whose first order is at least 28 days before the last date in the data. The median days figure is conditional on reordering. At least half of those second orders come the same day, which reads as split baskets, not returning customers."
          )
      )
    );
    out += nextCard("cohorts");
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Revenue                                                             */
  /* ------------------------------------------------------------------ */

  function bridgeSteps(cmp) {
    var sums = { sessions: 0, conversion: 0, aov: 0 };
    (cmp.by_device || []).forEach(function (row) {
      sums.sessions += row.sessions_effect;
      sums.conversion += row.conversion_effect;
      sums.aov += row.aov_effect;
    });
    return [
      { label: "Sessions", delta: sums.sessions },
      { label: "Conversion", delta: sums.conversion },
      { label: "Order value", delta: sums.aov }
    ];
  }

  function bridgeCard(cmp, periods) {
    var from = periods[cmp.from];
    var to = periods[cmp.to];
    var spec = {
      start: { label: cmp.from + " revenue", value: from.revenue_usd },
      end: { label: cmp.to + " revenue", value: to.revenue_usd },
      steps: bridgeSteps(cmp)
    };
    var chart = C.bridgeChart(spec, {
      title: cmp.from + " to " + cmp.to + " revenue bridge",
      desc:
        "Revenue moves from " +
        C.formatMoney(from.revenue_usd) +
        " to " +
        C.formatMoney(to.revenue_usd) +
        " through sessions, conversion and order value, summed over device segments.",
      format: function (v) {
        return C.formatMoney(v);
      }
    });
    return chart;
  }

  function renderRevenue(decomp, desc) {
    var periods = decomp.periods;
    var cmp23 = null;
    var cmp12 = null;
    (decomp.comparisons || []).forEach(function (cmp) {
      if (cmp.from === "P2" && cmp.to === "P3") {
        cmp23 = cmp;
      }
      if (cmp.from === "P1" && cmp.to === "P2") {
        cmp12 = cmp;
      }
    });

    var headline = "Revenue fell " + '<span class="hl">' + (cmp23 ? C.formatMoney(Math.abs(cmp23.delta_revenue_usd)) : DASH) + "</span> from P2 to P3, and conversion explains most of it.";
    var out = pageHead(
      "Decomposition",
      headline,
      "A bridge from one period's revenue to the next shows whether traffic, conversion or order value moved. Falls are drawn in the lost colour."
    );

    var periodCards = ["P1", "P2", "P3"].map(function (name) {
      var period = periods[name];
      return card(
        "Period " + name,
        dl([
          ["Dates", esc(period.start + " to " + period.end)],
          ["Sessions", C.formatInt(period.sessions)],
          ["Orders", C.formatInt(period.orders)],
          ["Revenue", C.formatMoney(period.revenue_usd)],
          ["Conversion", C.formatPct(period.conversion)],
          ["AOV", C.formatMoney(period.aov)]
        ])
      );
    });
    out += section("periods", "Three 28-day periods", '<div class="card-grid">' + periodCards.join("") + "</div>");

    var zero = desc && desc.data_quality && desc.data_quality.zero_revenue_by_period;
    var zeroSentence = "";
    if (zero && zero.P2 && zero.P3) {
      zeroSentence =
        "Zero-revenue orders were " +
        C.formatNum(zero.P2.share, "rate") +
        " of P2 orders and " +
        C.formatNum(zero.P3.share, "rate") +
        " of P3 orders, so part of the order-value fall is a data artefact.";
    }

    var bridgeSection = "";
    if (cmp23) {
      bridgeSection += chartCard(
        "P2 to P3: where the revenue went",
        bridgeCard(cmp23, periods),
        zeroSentence || "Each bar moves the running revenue by one term; the red bars are falls.",
        table(
          ["Term", "Dollars"],
          bridgeSteps(cmp23).map(function (s) {
            return [esc(s.label), C.formatMoney(s.delta)];
          })
        )
      );
    }
    if (cmp12) {
      bridgeSection += chartCard(
        "P1 to P2: where the revenue went",
        bridgeCard(cmp12, periods),
        "The holiday rise came from traffic and conversion in almost equal parts; order value barely moved.",
        table(
          ["Term", "Dollars"],
          bridgeSteps(cmp12).map(function (s) {
            return [esc(s.label), C.formatMoney(s.delta)];
          })
        )
      );
    }
    out += section("bridge", "Where the revenue went", bridgeSection);

    var logSection = "";
    (decomp.comparisons || []).forEach(function (cmp) {
      var lc = cmp.log_change;
      var terms = [
        { label: "Sessions", num: lc.sessions },
        { label: "Conversion", num: lc.conversion },
        { label: "Order value", num: lc.aov }
      ];
      var total = lc.total.value;
      var chart = C.divergingBarChart(
        terms.map(function (t) {
          return {
            label: t.label,
            value: t.num.value,
            ci_low: t.num.ci_low,
            ci_high: t.num.ci_high
          };
        }),
        {
          title: cmp.from + " to " + cmp.to + ": log change by term",
          format: function (v) {
            return C.formatValue(v, "log");
          }
        }
      );
      var shareRows = terms.map(function (t) {
        return [
          esc(t.label),
          C.formatNum(t.num, "log"),
          C.formatPct(total ? t.num.value / total : 0)
        ];
      });
      shareRows.push(["Total", C.formatNum(lc.total, "log"), C.formatPct(1)]);
      logSection += chartCard(
        cmp.from + " to " + cmp.to,
        chart,
        "The log change splits the revenue move into three terms that add up exactly; the whiskers are 95% bootstrap intervals.",
        table(["Term", "Log change", "Share of total"], shareRows)
      );
    });
    out += section("logchange", "What moved, in log terms", logSection);

    var segSection = "";
    (decomp.comparisons || []).forEach(function (cmp) {
      function dollars(title, rowsData) {
        return chartCard(
          title,
          table(
            ["Segment", "Revenue change", "Sessions", "Conversion", "Order value"],
            rowsData.map(function (row) {
              return [
                esc(prettyChannel(row.segment)),
                C.formatMoney(row.delta_revenue_usd),
                C.formatMoney(row.sessions_effect),
                C.formatMoney(row.conversion_effect),
                C.formatMoney(row.aov_effect)
              ];
            })
          ),
          "",
          ""
        );
      }
      segSection +=
        '<h3 class="group-head">' +
        esc(cmp.from + " to " + cmp.to) +
        "</h3>" +
        '<div class="chart-grid">' +
        dollars("By channel", cmp.by_channel) +
        dollars("By device", cmp.by_device) +
        "</div>";
    });
    out += section(
      "segments",
      "By channel and device",
      segSection +
        note(
          "The periods differ by season. This decomposition says which term moved; it does not say why, and nothing here is a causal claim."
        )
    );
    out += nextCard("revenue");
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Experiments                                                         */
  /* ------------------------------------------------------------------ */

  function renderExperiments(exp) {
    var out = "";
    var peek = exp.peeking;

    var headline =
      "Checking a test every day would call " +
      '<span class="hl">' +
      C.formatPct(peek.fpr_naive_peeking.value) +
      "</span> of no-effect tests a win, against " +
      C.formatPct(peek.fpr_fixed_horizon.value) +
      " when it is tested once.";
    out += pageHead(
      "Method check",
      headline,
      "No experiment exists in this data; every effect is planted. These figures check whether the testing engine behaves the way theory says it should."
    );

    out +=
      '<div class="notice notice-strong" data-reveal><p class="notice-title">Method check</p><p>' +
      esc(exp.meta.note) +
      '</p><p class="note">Population: ' +
      C.formatInt(exp.meta.n_users) +
      " users with a session in the final " +
      C.formatInt(exp.meta.window_days) +
      "-day window. Simulations: " +
      C.formatInt(exp.meta.n_sims) +
      ". Alpha: " +
      C.formatValue(exp.meta.alpha, "number") +
      ".</p></div>";

    out += section(
      "peeking",
      "The peeking trap",
      '<div class="bigstat-row">' +
        bigStat("Tested once at the end", peek.fpr_fixed_horizon, "rate", "The correct way to test.") +
        bigStat("Checked every day, stop at the first win", peek.fpr_naive_peeking, "rate", "The false-win rate balloons.") +
        bigStat("Checked daily with a boundary", peek.fpr_sequential, "rate", "A sequential boundary holds the rate near 5%.") +
        "</div>" +
        note(
          "Each figure is the false-positive rate over " +
            C.formatInt(exp.meta.n_sims) +
            " A/A simulations. The band that counts as a pass is " +
            C.formatPct(peek.band_low) +
            " to " +
            C.formatPct(peek.band_high) +
            "."
        )
    );

    var passRows = [
      ["A/A false positives, conversion", C.formatNum(exp.aa.fpr_conversion, "rate"), "3.7% to 6.4%", badge(exp.aa.pass_conversion)],
      ["A/A false positives, revenue per user", C.formatNum(exp.aa.fpr_revenue, "rate"), "3.7% to 6.4%", badge(exp.aa.pass_revenue)],
      ["Daily peeking with the boundary", C.formatNum(peek.fpr_sequential, "rate"), "at most 6.4%", badge(peek.pass_sequential)]
    ];
    exp.planted.forEach(function (row) {
      passRows.push([
        "Interval coverage, planted " + C.formatPct(row.rel_lift, 0) + " lift",
        C.formatNum(row.coverage, "rate"),
        "93% to 97%",
        badge(row.pass)
      ]);
    });
    out += section(
      "passrules",
      "Pass rules",
      chartCard(
        "Every check and its verdict",
        table(["Check", "Result", "Rule", "Verdict"], passRows),
        "A FAIL would appear here with the same weight as a PASS. All the rules were fixed before the numbers were computed.",
        ""
      )
    );

    var base = exp.baseline;
    out += section(
      "baseline",
      "Baseline",
      '<div class="kpi-grid">' +
        kpiEstimate("Conversion rate", base.conversion_rate, "rate") +
        kpiEstimate("Revenue per user", base.revenue_per_user, "money") +
        "</div>"
    );

    var powerTable = table(
      ["Relative lift", "Users per arm needed", "Power at the actual n"],
      exp.power.map(function (row) {
        return [
          C.formatPct(row.rel_lift, 0),
          C.formatInt(row.n_per_arm_needed),
          C.formatPct(row.power_at_actual_n)
        ];
      })
    );
    out += section(
      "power",
      "Power",
      chartCard(
        "What this store can detect",
        powerTable,
        "The minimum detectable relative lift at the actual sample size is " +
          C.formatPct(exp.mde_at_actual_n) +
          ". Small lifts need far more traffic than one month provides.",
        ""
      )
    );

    var aa = exp.aa;
    var aaBand = C.formatPct(aa.band_low) + " to " + C.formatPct(aa.band_high);
    out += section(
      "aa",
      "A/A calibration",
      chartCard(
        "False positives when there is no effect",
        table(
          ["Metric", "False-positive rate", "Pass band", "Result"],
          [
            ["Conversion", C.formatNum(aa.fpr_conversion, "rate"), aaBand, badge(aa.pass_conversion)],
            ["Revenue", C.formatNum(aa.fpr_revenue, "rate"), aaBand, badge(aa.pass_revenue)]
          ]
        ),
        C.formatInt(exp.meta.n_sims) +
          " A/A splits. The conversion p-value distribution KS test p = " +
          formatP(aa.ks_p_conversion) +
          ".",
        ""
      )
    );

    var plantedTable = table(
      ["Relative lift", "True difference", "Bias", "Power", "Coverage", "Result"],
      exp.planted.map(function (row) {
        return [
          C.formatPct(row.rel_lift, 0),
          C.formatPct(row.true_diff, 3),
          C.formatPct(row.bias, 3),
          C.formatNum(row.power, "rate"),
          C.formatNum(row.coverage, "rate"),
          badge(row.pass)
        ];
      })
    );
    out += section(
      "planted",
      "Planted lifts",
      chartCard(
        "Does the interval cover the truth?",
        plantedTable,
        "Every effect was planted. A lift passes when its 95% interval covers the true difference in 93% to 97% of runs.",
        ""
      )
    );

    var cuped = exp.cuped;
    out += section(
      "cuped",
      term("cuped", "CUPED"),
      chartCard(
        "Variance reduction from a pre-period covariate",
        table(
          ["Metric", "Estimate", "Theta"],
          [
            ["Share with any history", C.formatNum(cuped.share_with_pre_period, "rate"), DASH],
            ["Conversion variance reduction", C.formatNum(cuped.conversion.variance_reduction, "rate"), C.formatValue(cuped.conversion.theta, "number")],
            ["Revenue variance reduction", C.formatNum(cuped.revenue.variance_reduction, "rate"), C.formatValue(cuped.revenue.theta, "number")]
          ]
        ),
        "Only " +
          C.formatPct(cuped.share_with_pre_period.value) +
          " of users have any earlier visit, so the reduction is small and CUPED is not worth running here.",
        ""
      )
    );

    var cross = exp.cross_checks;
    out += section(
      "crosschecks",
      "Cross-checks on one fixed split",
      card(
        "",
        table(
          ["Check", "Value"],
          [
            ["Conversion z-test p", formatP(cross.conversion.z_test_p)],
            ["Conversion permutation p", formatP(cross.conversion.permutation_p) + " (" + C.formatInt(cross.conversion.n_perm) + " permutations)"],
            ["Revenue difference", C.formatValue(cross.revenue.diff, "number")],
            ["Revenue Welch interval", esc(C.formatValue(cross.revenue.welch_ci[0], "number") + " to " + C.formatValue(cross.revenue.welch_ci[1], "number"))],
            ["Revenue bootstrap interval", esc(C.formatValue(cross.revenue.bootstrap_ci[0], "number") + " to " + C.formatValue(cross.revenue.bootstrap_ci[1], "number"))]
          ]
        )
      )
    );
    out += nextCard("experiments");
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Data quality                                                        */
  /* ------------------------------------------------------------------ */

  function pairBar(label, raw, modelled, format) {
    var scaleMax = Math.max(raw, modelled) || 1;
    var rawW = (raw / scaleMax) * 100;
    var modW = (modelled / scaleMax) * 100;
    var gap = raw - modelled;
    return (
      '<div class="pairbar">' +
      '<p class="pairbar-title">' +
      esc(label) +
      "</p>" +
      '<div class="pairbar-row"><span class="pairbar-tag">Raw</span><span class="pairbar-track"><span class="pairbar-fill pairbar-raw" style="width:' +
      rawW.toFixed(2) +
      '%"></span></span><span class="pairbar-value">' +
      format(raw) +
      "</span></div>" +
      '<div class="pairbar-row"><span class="pairbar-tag">Modelled</span><span class="pairbar-track"><span class="pairbar-fill pairbar-mod" style="width:' +
      modW.toFixed(2) +
      '%"></span></span><span class="pairbar-value">' +
      format(modelled) +
      "</span></div>" +
      '<p class="pairbar-gap">Gap: ' +
      format(gap) +
      "</p></div>"
    );
  }

  function renderQuality(desc) {
    var q = desc.data_quality;
    var gap = q.raw_purchase_revenue_usd - q.order_revenue_usd;
    var gapShare = q.raw_purchase_revenue_usd ? gap / q.raw_purchase_revenue_usd : 0;

    var headline =
      "Summing the raw purchase events would overstate revenue by " +
      '<span class="hl">' +
      C.formatMoney(gap) +
      "</span> (" +
      C.formatPct(gapShare) +
      ").";
    var out = pageHead(
      "Trust",
      headline,
      "The models reshape the raw events rather than recompute them. Where the two differ, both sides and the gap are shown."
    );

    out += section(
      "reconcile",
      "Raw against modelled",
      card(
        "Paired bars for the three checks",
        pairBar("Purchase events against orders", q.raw_purchase_events, q.orders, C.formatInt) +
          pairBar("Raw purchase revenue against order revenue", q.raw_purchase_revenue_usd, q.order_revenue_usd, C.formatMoney) +
          note(
            "Orders are lower because repeated purchase events are collapsed into one order per transaction id, and one per session when the id is (not set). Order revenue is lower because collapsing keeps the largest revenue per order and drops the duplicate events behind it."
          )
      )
    );

    var rows = [
      ["Raw events vs modelled events", C.formatInt(q.raw_events), C.formatInt(q.mart_events), C.formatInt(q.mart_events - q.raw_events)],
      ["Purchase events vs orders", C.formatInt(q.raw_purchase_events), C.formatInt(q.orders), C.formatInt(q.orders - q.raw_purchase_events)],
      ["Raw purchase revenue vs order revenue", C.formatMoney(q.raw_purchase_revenue_usd), C.formatMoney(q.order_revenue_usd), C.formatMoney(gap) + " (" + C.formatPct(gapShare) + ")"],
      ["(not set) transaction events", C.formatInt(q.not_set_transaction_events), DASH, DASH],
      ["Session source-parameter coverage", C.formatPct(q.session_source_param_coverage), DASH, DASH]
    ];
    out += section(
      "table",
      "Reconciliation",
      chartCard(
        "Every check, raw and modelled",
        table(["Check", "Raw", "Modelled", "Difference"], rows),
        "The modelled event count matches the raw count exactly. " +
          C.formatInt(q.not_set_transaction_events) +
          " purchase events carry no transaction id, so they can only be collapsed per session.",
        ""
      )
    );

    var zero = q.zero_revenue_by_period || {};
    var zeroRows = ["P1", "P2", "P3"]
      .filter(function (name) {
        return zero[name];
      })
      .map(function (name) {
        var z = zero[name];
        return [
          esc(name),
          C.formatInt(z.orders),
          C.formatInt(z.zero_revenue_orders),
          C.formatNum(z.share, "rate"),
          C.formatMoney(z.aov_paid_orders)
        ];
      });
    if (zeroRows.length) {
      out += section(
        "zero",
        "Zero-revenue orders by period",
        chartCard(
          "Orders with no revenue",
          table(["Period", "Orders", "Zero-revenue orders", "Share", "AOV, paid orders"], zeroRows),
          "Orders are placed in a period by the session date of their session. AOV here is revenue divided by orders with revenue above zero. The P3 share is the tracking problem behind the order-value fall.",
          ""
        )
      );
    }
    out += nextCard("quality");
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Runtime loader (browser only)                                       */
  /* ------------------------------------------------------------------ */

  function getJSON(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) {
        throw new Error("Request failed");
      }
      return response.json();
    });
  }

  function renderFor(page, results) {
    if (page === "index") {
      return renderOverview(results[0], results[1], results[2]);
    }
    if (page === "funnel") {
      return renderFunnel(results[0]);
    }
    if (page === "cohorts") {
      return renderCohorts(results[0]);
    }
    if (page === "revenue") {
      return renderRevenue(results[0], results[1]);
    }
    if (page === "experiments") {
      return renderExperiments(results[0]);
    }
    if (page === "quality") {
      return renderQuality(results[0]);
    }
    return "";
  }

  function sourcesFor(page) {
    if (page === "revenue") {
      return ["data/decomposition.json", "data/descriptive.json"];
    }
    if (page === "experiments") {
      return ["data/experiments.json"];
    }
    if (page === "index") {
      return [
        "data/descriptive.json",
        "data/decomposition.json",
        "data/experiments.json"
      ];
    }
    return ["data/descriptive.json"];
  }

  function mount() {
    var target = document.getElementById("content");
    if (!target) {
      return;
    }
    var page = target.getAttribute("data-page") || "";
    Promise.all(sourcesFor(page).map(getJSON))
      .then(function (results) {
        if (page !== "lab") {
          target.innerHTML = renderFor(page, results);
        }
        var desc = null;
        for (var i = 0; i < results.length; i += 1) {
          if (results[i] && results[i].meta && results[i].meta.date_min) {
            desc = results[i];
            break;
          }
        }
        var footer = document.getElementById("footer-slot");
        if (footer && desc) {
          footer.innerHTML = renderFooter(desc);
        }
        if (typeof window !== "undefined" && window.Site) {
          window.Site.observe(document);
          window.Site.glossary(document);
        }
        if (page === "index" && typeof window !== "undefined" && window.Hero) {
          window.Hero.mount(document.querySelector("[data-hero]"));
        }
      })
      .catch(function () {
        if (page !== "lab") {
          target.innerHTML =
            '<p class="placeholder">Data is not available yet.</p>';
        }
      });
  }

  var api = {
    renderOverview: renderOverview,
    renderFunnel: renderFunnel,
    renderCohorts: renderCohorts,
    renderRevenue: renderRevenue,
    renderExperiments: renderExperiments,
    renderQuality: renderQuality,
    renderFooter: renderFooter,
    renderFor: renderFor,
    sourcesFor: sourcesFor,
    mount: mount
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.Pages = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
