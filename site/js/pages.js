/* Pure page renderers for the Buyer Analytics site.
 *
 * One function per page. Each takes the parsed JSON artefact(s) and returns an
 * HTML string; nothing touches the DOM, so the functions can be called from
 * Node for testing. Chart and number formatting come from charts.js, which is
 * loaded either from the page (window.Charts) or with require() under Node.
 */
(function (global) {
  "use strict";

  var C =
    typeof module !== "undefined" && module.exports
      ? require("./charts.js")
      : global.Charts;

  var DASH = "\u2014";

  function esc(value) {
    return C.escape(value);
  }

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  function section(title, body) {
    return (
      '<section class="section">' +
      (title ? "<h2>" + esc(title) + "</h2>" : "") +
      body +
      "</section>"
    );
  }

  function details(summary, body) {
    return (
      '<details class="data-toggle"><summary>' + esc(summary) + "</summary>" + body + "</details>"
    );
  }

  function card(title, body) {
    return (
      '<section class="card">' +
      (title ? "<h2>" + esc(title) + "</h2>" : "") +
      body +
      "</section>"
    );
  }

  function table(headers, rows) {
    var out = '<div class="table-wrap"><table><thead><tr>';
    for (var h = 0; h < headers.length; h += 1) {
      out += '<th' + (h > 0 ? ' class="num"' : "") + ">" + esc(headers[h]) + "</th>";
    }
    out += "</tr></thead><tbody>";
    for (var r = 0; r < rows.length; r += 1) {
      out += "<tr>";
      for (var c = 0; c < rows[r].length; c += 1) {
        out += '<td' + (c > 0 ? ' class="num"' : "") + ">" + rows[r][c] + "</td>";
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

  function kpi(label, value, sub) {
    return (
      '<div class="kpi"><div class="kpi-label">' +
      esc(label) +
      '</div><div class="kpi-value">' +
      value +
      "</div>" +
      (sub ? '<div class="kpi-sub">' + sub + "</div>" : "") +
      "</div>"
    );
  }

  function badge(ok) {
    return (
      '<span class="badge ' +
      (ok ? "badge-pass" : "badge-fail") +
      '">' +
      (ok ? "PASS" : "FAIL") +
      "</span>"
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

  function formatP(value) {
    if (!isNum(value)) {
      return DASH;
    }
    if (value < 0.0001) {
      return "< 0.0001";
    }
    return value.toFixed(4);
  }

  /* ------------------------------------------------------------------ */
  /* 1. Overview                                                         */
  /* ------------------------------------------------------------------ */

  function renderOverview(desc, decomp) {
    var k = desc.kpis;
    var weeks = desc.weekly;

    var readFirst =
      '<ul class="note-list">' +
      '<li>One browser cookie is one "user". User counts are cookie counts, not people, ' +
      "and cross-device behaviour cannot be joined because the user id is always empty.</li>" +
      "<li>Channel is the first-touch source of the user, fixed when the user first arrives. " +
      "It is not the source of each session and it is not last-click attribution.</li>" +
      "<li>The period runs from " +
      esc(desc.meta.date_min) +
      " to " +
      esc(desc.meta.date_max) +
      " and includes Black Friday and Christmas.</li>" +
      "<li>The data contains no real experiment. The experiments page is a method check on " +
      "real traffic, and every effect there is planted.</li>" +
      "</ul>";

    var cards = [
      kpi("Sessions", C.formatInt(k.sessions), "exact count"),
      kpi("Users", C.formatInt(k.users), "one cookie each"),
      kpi("Orders", C.formatInt(k.orders), "after collapsing"),
      kpi("Revenue", C.formatMoney(k.revenue_usd), "sum of order revenue"),
      kpi(
        "Session conversion",
        C.formatValue(k.session_conversion.value, "rate"),
        C.numDetail(k.session_conversion, "rate")
      ),
      kpi(
        "User conversion",
        C.formatValue(k.user_conversion.value, "rate"),
        C.numDetail(k.user_conversion, "rate")
      ),
      kpi("AOV", C.formatValue(k.aov.value, "money"), C.numDetail(k.aov, "money")),
      kpi(
        "Revenue per user",
        C.formatValue(k.revenue_per_user.value, "money"),
        C.numDetail(k.revenue_per_user, "money")
      ),
      kpi(
        "Items per order",
        C.formatValue(k.items_per_order.value, "number"),
        C.numDetail(k.items_per_order, "number")
      ),
      kpi(
        "Zero-revenue orders",
        C.formatValue(k.zero_revenue_order_share.value, "rate"),
        C.numDetail(k.zero_revenue_order_share, "rate")
      )
    ];

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

    var out = "";
    out += section("Key numbers", '<div class="kpi-grid">' + cards.join("") + "</div>");
    out += card("Read this first", readFirst);
    out += section(
      "Weekly trend",
      card("Sessions", sessionsChart + details("Show weekly values", sessionsTable)) +
        card("Revenue", revenueChart + details("Show weekly values", revenueTable)) +
        card("Session conversion", conversionChart + details("Show weekly values with intervals", conversionTable))
    );
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 2. Funnel                                                           */
  /* ------------------------------------------------------------------ */

  function renderFunnel(desc) {
    var f = desc.funnel;
    var steps = f.steps;
    var overall = f.overall;
    var last = steps.length - 1;
    var out = "";

    var funnelRows = steps.map(function (step, index) {
      return { label: prettyStep(step), count: overall.reached[index] };
    });
    var funnelChart = C.funnelChart(funnelRows, {
      title: "Closed funnel: sessions reaching each step"
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
      "Overall funnel",
      card(
        "",
        funnelChart +
          funnelTable +
          '<p class="note">Closed counts need every earlier step in the same session; open ' +
          "counts only need the step itself. They differ because a cart or checkout can start " +
          "in an earlier session, so the later session has the event without the earlier ones.</p>"
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

    function segmentCard(title, blockMap) {
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
      return card(
        title,
        chart +
          table(["Segment", "Purchases", "Sessions", "Purchase rate"], rows)
      );
    }

    out += section(
      "Purchase rate from sessions",
      segmentCard("By device", f.by_device) +
        segmentCard("By channel", f.by_channel) +
        segmentCard("By country group", f.by_country)
    );

    var skipped = f.skipped_step_share;
    out += section(
      "Skipped steps",
      card(
        "",
        '<p class="big-num">' +
          C.formatNum(skipped, "rate") +
          "</p>" +
          '<p class="note">This is the share of sessions with a purchase event that skipped at ' +
          "least one earlier closed-funnel step. A purchase can be logged without every earlier " +
          "step being recorded first, so the closed funnel is a lower bound on each step.</p>"
      )
    );

    var tests = desc.segment_tests.filter(function (test) {
      return test.page === "funnel";
    });
    var testTable = table(
      ["Comparison", "Metric", "Difference", "Raw p", "Holm p"],
      tests.map(function (test) {
        return [
          esc(test.a + " vs " + test.b),
          esc(prettyMetric(test.metric)),
          C.formatPct(test.diff),
          formatP(test.p_raw),
          formatP(test.p_holm)
        ];
      })
    );
    out += section(
      "Funnel segment tests",
      card(
        "",
        testTable +
          '<p class="note">Two-proportion tests with Holm correction across the comparisons on ' +
          "this page. A small Holm p means the two segments differ.</p>"
      )
    );

    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 3. Cohorts                                                          */
  /* ------------------------------------------------------------------ */

  function renderCohorts(desc) {
    var cohorts = desc.cohorts;
    var maxOffset = 0;
    cohorts.forEach(function (cohort) {
      cohort.retention.forEach(function (point) {
        if (point.week_offset > maxOffset) {
          maxOffset = point.week_offset;
        }
      });
    });

    var cols = [];
    for (var i = 0; i <= maxOffset; i += 1) {
      cols.push(String(i));
    }
    var matrix = cohorts.map(function (cohort) {
      var row = new Array(maxOffset + 1);
      cohort.retention.forEach(function (point) {
        row[point.week_offset] = point.rate.value * 100;
      });
      return row;
    });
    var rowLabels = cohorts.map(function (cohort) {
      return cohort.cohort_week;
    });

    var heat = C.heatmap(matrix, rowLabels, cols, {
      title: "Retention by cohort week and week offset",
      format: function (value) {
        return (Math.round(value * 10) / 10).toFixed(1) + "%";
      }
    });

    var cohortRows = cohorts.map(function (cohort) {
      var first = cohort.retention.filter(function (point) {
        return point.week_offset === 1;
      })[0];
      return [
        esc(cohort.cohort_week),
        C.formatInt(cohort.cohort_users),
        first ? C.formatNum(first.rate, "rate") : DASH
      ];
    });
    var cohortTable = table(
      ["Cohort week", "Cohort users", "Week-1 retention"],
      cohortRows
    );

    var out = section(
      "Retention heatmap",
      card(
        "",
        heat +
          cohortTable +
          '<p class="note">Each row is a cohort week (the Monday of a first event). Each column ' +
          "is weeks after that first week. The value is the share of the cohort with at least one " +
          "session in that week; only fully observed cells are shown.</p>"
      )
    );

    var rep = desc.repeat;
    out += section(
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
          '<p class="note">The repeat rate is measured among buyers whose first order is at ' +
          "least 28 days before the last date in the data. The median days figure is conditional " +
          "on reordering.</p>"
      )
    );
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 4. Revenue                                                          */
  /* ------------------------------------------------------------------ */

  function renderRevenue(decomp, desc) {
    var out = "";
    var periods = decomp.periods;

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
    out += section("Periods", '<div class="card-grid">' + periodCards.join("") + "</div>");

    decomp.comparisons.forEach(function (cmp) {
      var lc = cmp.log_change;
      var terms = [
        { label: "Sessions", num: lc.sessions },
        { label: "Conversion", num: lc.conversion },
        { label: "AOV", num: lc.aov }
      ];
      var total = lc.total.value;

      var chart = C.divergingBarChart(
        terms.map(function (term) {
          return {
            label: term.label,
            value: term.num.value,
            ci_low: term.num.ci_low,
            ci_high: term.num.ci_high
          };
        }),
        {
          title: cmp.from + " to " + cmp.to + ": log change by term",
          format: function (v) {
            return C.formatValue(v, "log");
          }
        }
      );

      var shareRows = terms.map(function (term) {
        return [
          esc(term.label),
          C.formatNum(term.num, "log"),
          C.formatPct(total ? term.num.value / total : 0)
        ];
      });
      shareRows.push(["Total", C.formatNum(lc.total, "log"), C.formatPct(1)]);
      var shareTable = table(["Term", "Log change", "Share of total"], shareRows);

      function dollars(title, rowsData) {
        return card(
          title,
          table(
            ["Segment", "Revenue change", "Sessions", "Conversion", "AOV"],
            rowsData.map(function (row) {
              return [
                esc(row.segment),
                C.formatMoney(row.delta_revenue_usd),
                C.formatMoney(row.sessions_effect),
                C.formatMoney(row.conversion_effect),
                C.formatMoney(row.aov_effect)
              ];
            })
          )
        );
      }

      var zeroNote = "";
      var zero = desc && desc.data_quality && desc.data_quality.zero_revenue_by_period;
      if (cmp.from === "P2" && cmp.to === "P3" && zero && zero.P2 && zero.P3) {
        zeroNote =
          '<p class="note">Zero-revenue orders were ' +
          C.formatNum(zero.P2.share, "rate") +
          " of P2 orders and " +
          C.formatNum(zero.P3.share, "rate") +
          " of P3 orders, so part of the AOV fall is a data artefact.</p>";
      }

      out += section(
        "Change " + cmp.from + " to " + cmp.to,
        card("", chart + shareTable + zeroNote) +
          '<div class="card-grid">' +
          dollars("By channel", cmp.by_channel) +
          dollars("By device", cmp.by_device) +
          "</div>"
      );
    });

    out +=
      '<p class="note">The periods differ by season. This decomposition says which term ' +
      "moved; it does not say why, and nothing here is a causal claim.</p>";
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 5. Experiments                                                      */
  /* ------------------------------------------------------------------ */

  function renderExperiments(exp) {
    var out = "";
    out +=
      '<div class="notice notice-strong"><p><strong>Method check.</strong> ' +
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

    var base = exp.baseline;
    out += section(
      "Baseline",
      card(
        "",
        table(
          ["Metric", "Estimate"],
          [
            ["Conversion rate", C.formatNum(base.conversion_rate, "rate")],
            ["Revenue per user", C.formatNum(base.revenue_per_user, "money")]
          ]
        )
      )
    );

    var powerTable = table(
      ["Relative lift", "Users per arm needed", "Power at actual n"],
      exp.power.map(function (row) {
        return [
          C.formatPct(row.rel_lift, 0),
          C.formatInt(row.n_per_arm_needed),
          C.formatPct(row.power_at_actual_n)
        ];
      })
    );
    out += section(
      "Power",
      card(
        "",
        powerTable +
          '<p class="note">Minimum detectable relative lift at the actual sample size: ' +
          C.formatPct(exp.mde_at_actual_n) +
          ".</p>"
      )
    );

    var aa = exp.aa;
    var aaBand = C.formatPct(aa.band_low) + " to " + C.formatPct(aa.band_high);
    out += section(
      "A/A false-positive rate",
      card(
        "",
        table(
          ["Metric", "False-positive rate", "Pass band", "Result"],
          [
            [
              "Conversion",
              C.formatNum(aa.fpr_conversion, "rate"),
              aaBand,
              badge(aa.pass_conversion)
            ],
            [
              "Revenue",
              C.formatNum(aa.fpr_revenue, "rate"),
              aaBand,
              badge(aa.pass_revenue)
            ]
          ]
        ) +
          '<p class="note">' +
          C.formatInt(exp.meta.n_sims) +
          " A/A splits. The false-positive rate must land in the central 95% binomial band (" +
          aaBand +
          "). Conversion p-value distribution KS test p = " +
          formatP(aa.ks_p_conversion) +
          ".</p>"
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
      "Planted lifts",
      card(
        "",
        plantedTable +
          '<p class="note">Every effect was planted. A lift passes when its 95% interval ' +
          "covers the true difference in 93% to 97% of runs.</p>"
      )
    );

    var cuped = exp.cuped;
    out += section(
      "CUPED",
      card(
        "",
        table(
          ["Metric", "Estimate", "Theta"],
          [
            [
              "Share with any history",
              C.formatNum(cuped.share_with_pre_period, "rate"),
              DASH
            ],
            [
              "Conversion variance reduction",
              C.formatNum(cuped.conversion.variance_reduction, "rate"),
              C.formatValue(cuped.conversion.theta, "number")
            ],
            [
              "Revenue variance reduction",
              C.formatNum(cuped.revenue.variance_reduction, "rate"),
              C.formatValue(cuped.revenue.theta, "number")
            ]
          ]
        ) +
          '<p class="note">The covariate is sessions before the window for conversion, and ' +
          "revenue before the window for revenue. The reduction is expected to be small because " +
          "few users have any history.</p>"
      )
    );

    var peek = exp.peeking;
    out += section(
      "Peeking",
      card(
        "",
        table(
          ["Look strategy", "False-positive rate", "Result"],
          [
            ["Fixed horizon", C.formatNum(peek.fpr_fixed_horizon, "rate"), DASH],
            ["Naive peeking", C.formatNum(peek.fpr_naive_peeking, "rate"), DASH],
            [
              "Sequential",
              C.formatNum(peek.fpr_sequential, "rate"),
              badge(peek.pass_sequential)
            ]
          ]
        ) +
          '<p class="note">' +
          C.formatInt(peek.n_looks) +
          " daily looks. The sequential boundary is O'Brien-Fleming shaped with constant " +
          C.formatValue(peek.obf_constant, "number") +
          "; it must not exceed the band top of " +
          C.formatPct(peek.band_high) +
          ".</p>"
      )
    );

    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 6. Data quality                                                     */
  /* ------------------------------------------------------------------ */

  function renderQuality(desc) {
    var q = desc.data_quality;
    var gap = q.raw_purchase_revenue_usd - q.order_revenue_usd;
    var gapShare = q.raw_purchase_revenue_usd
      ? gap / q.raw_purchase_revenue_usd
      : 0;

    var rows = [
      [
        "Raw events vs modelled events",
        C.formatInt(q.raw_events),
        C.formatInt(q.mart_events),
        C.formatInt(q.mart_events - q.raw_events)
      ],
      [
        "Purchase events vs orders",
        C.formatInt(q.raw_purchase_events),
        C.formatInt(q.orders),
        C.formatInt(q.orders - q.raw_purchase_events)
      ],
      [
        "Raw purchase revenue vs order revenue",
        C.formatMoney(q.raw_purchase_revenue_usd),
        C.formatMoney(q.order_revenue_usd),
        C.formatMoney(gap) + " (" + C.formatPct(gapShare) + ")"
      ],
      [
        "(not set) transaction events",
        C.formatInt(q.not_set_transaction_events),
        DASH,
        DASH
      ],
      [
        "Session source-parameter coverage",
        C.formatPct(q.session_source_param_coverage),
        DASH,
        DASH
      ]
    ];

    var notes = [
      [
        "Raw events vs modelled events",
        "The models only reshape the raw events, so the modelled event count matches the raw " +
          "count exactly."
      ],
      [
        "Purchase events vs orders",
        "Orders are lower because repeated purchase events are collapsed into one order per " +
          "transaction id, and one per session when the id is (not set)."
      ],
      [
        "Revenue",
        "Order revenue is lower because collapsing keeps the largest revenue per order and " +
          "drops the duplicate purchase events behind it."
      ],
      [
        "(not set) transaction events",
        "These purchase events carry no transaction id, so they cannot be matched by id and " +
          "are grouped per user and session instead."
      ],
      [
        "Session source-parameter coverage",
        "Only " +
          C.formatPct(q.session_source_param_coverage) +
          " of sessions carry session-level source parameters. The rest have none, which is why " +
          "channel uses the user first-touch source."
      ]
    ];

    var noteList =
      '<ul class="note-list">' +
      notes
        .map(function (item) {
          return (
            "<li><strong>" +
            esc(item[0]) +
            ".</strong> " +
            item[1] +
            "</li>"
          );
        })
        .join("") +
      "</ul>";

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
    var zeroSection = zeroRows.length
      ? section(
          "Zero-revenue orders by period",
          card(
            "",
            table(
              ["Period", "Orders", "Zero-revenue orders", "Share", "AOV, paid orders"],
              zeroRows
            ) +
              '<p class="note">Orders are placed in a period by the session date of their ' +
              "session. AOV here is revenue divided by orders with revenue above zero.</p>"
          )
        )
      : "";

    return (
      section(
        "Reconciliation",
        card(
          "",
          table(["Check", "Raw", "Modelled", "Difference"], rows) + noteList
        )
      ) + zeroSection
    );
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
      return renderOverview(results[0], results[1]);
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
      return ["data/descriptive.json", "data/decomposition.json"];
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
        target.innerHTML = renderFor(page, results);
      })
      .catch(function () {
        target.innerHTML =
          '<p class="placeholder">Data is not available yet.</p>';
      });
  }

  var api = {
    renderOverview: renderOverview,
    renderFunnel: renderFunnel,
    renderCohorts: renderCohorts,
    renderRevenue: renderRevenue,
    renderExperiments: renderExperiments,
    renderQuality: renderQuality,
    mount: mount
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.Pages = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
