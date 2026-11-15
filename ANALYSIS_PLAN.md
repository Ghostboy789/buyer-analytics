# Analysis plan

Written before any metric, funnel, cohort, decomposition or experiment result was computed.
The commit history shows this file landing before the models and the analysis code.

## What had been seen when this was written

Only the raw-data profile in `docs/DATA_PROFILE.md` (row counts, event names, null and
redaction rates, purchase-event duplicates) and weekly totals of users, purchasers and revenue,
which were looked at to choose comparison periods. No conversion rate by segment, no funnel
rate, no retention figure and no experiment output existed.

Facts from the profile that shape the rules below:

- 4,295,584 events, 270,154 `user_pseudo_id`, 360,129 sessions, 2020-11-01 to 2021-01-31.
  `event_date` lines up with the UTC date of `event_timestamp`.
- `ga_session_id` is present on every event. `user_id` is never present.
- 5,692 purchase events but 4,451 real transaction ids: 326 ids repeat across events, 15 ids
  appear under more than one user, and 906 purchase events carry `(not set)` as the id.
- 450 purchase events have zero revenue.
- Session-level source parameters exist on 73.5% of sessions and are dominated by the store's
  own domain as a referrer. The user-level first-touch source is always filled, with 33.6% of
  users showing `<Other>` and 6.6% `(data deleted)` as source.
- 82.5% of users have exactly one session.

## Definitions

**User.** One `user_pseudo_id`: a browser cookie, not a person. Cross-device behaviour cannot
be joined because `user_id` is empty. Every "user" figure is a cookie figure.

**Session.** One pair (`user_pseudo_id`, `ga_session_id`). Its date is the UTC date of its
first event; a session that runs past midnight stays on its start date.

**Order.** Purchase events are collapsed, because the raw events repeat:

1. Events with a real transaction id: one order per (`user_pseudo_id`, `transaction_id`). The
   earliest event gives the timestamp and session; revenue is the largest
   `purchase_revenue_in_usd` among the collapsed events.
2. Events whose id is `(not set)`: one order per (`user_pseudo_id`, session), same rules.

The same id under two users stays as two orders: nothing in the data says which is real.
Zero-revenue orders stay orders. Revenue is `purchase_revenue_in_usd`; tax, shipping and
refunds are not netted.

**Metrics.** All ratios are ratios of sums over the stated period, never averages of daily
ratios.

| Metric | Rule |
|---|---|
| Sessions, users, orders, revenue | Counts and sums under the definitions above |
| Session conversion | Sessions with at least one order / sessions |
| User conversion | Users with at least one order in the period / users active in the period |
| AOV | Revenue / orders, zero-revenue orders included; their share is reported beside it |
| Revenue per user | Revenue / users active in the period |
| Items per order | Sum of `total_item_quantity` / orders |
| Repeat purchase, 28 days | Among buyers whose first order is at least 28 days before the last date in the data: share with a second order within 28 days of the first |
| Days to second order | Median among those who did reorder. Conditional on reordering, labelled so |

**Channel.** The user's first-touch `traffic_source`, grouped in this order:

1. `direct`: source `(direct)` and medium `(none)`
2. `organic_search`: medium `organic`
3. `paid_search`: medium `cpc`
4. `referral`: medium `referral`
5. `undisclosed`: source or medium is `<Other>` or `(data deleted)` and no rule above matched
6. `other`: everything left

This is an acquisition channel fixed per user. It is not the source of each session and it is
not last-click attribution. Session-level parameters are too incomplete to use; their coverage
is reported on the data-quality page.

**Device and country.** Taken from the session's first event. Country groups are the five
countries with the most sessions, plus `Other`.

**Cohort week.** The Monday-start week of a user's first event in the data. The data is
left-censored: a user "first seen" on 1 November may be older. Cohorts whose first week is
only partly inside the data are left out. Retention at week k is the share of the cohort with
at least one session in week k; only fully observed cells are shown.

## Funnel

Steps, per session: `view_item` → `add_to_cart` → `begin_checkout` → `add_shipping_info` →
`add_payment_info` → `purchase`.

A session reached step k if it contains the step-k event and reached step k−1. Order inside a
session is not checked by timestamp, because events arrive in batches with equal timestamps.
This closed funnel can only fall from step to step. The share of purchasing sessions that
skipped an earlier step is measured and published; if it is above 10% of purchasing sessions,
the open counts (event present, earlier steps ignored) are shown beside the closed ones.

Rates carry Wilson 95% intervals. Sessions of the same user are not independent, so
session-level intervals are slightly too narrow; with 82.5% single-session users the effect is
small, and it is stated on the page. Splits: device, channel, country group.

## Revenue decomposition

Periods are fixed here, as three blocks of 28 days, each with four of every weekday:

| Period | Dates | Label |
|---|---|---|
| P1 | 2020-11-02 to 2020-11-29 | Pre-holiday, includes Black Friday |
| P2 | 2020-11-30 to 2020-12-27 | Holiday peak |
| P3 | 2021-01-04 to 2021-01-31 | Post-holiday |

1 November (a lone Sunday) and the week of 28 December are left out. Comparisons: P1→P2 and
P2→P3.

Revenue = sessions × (orders / sessions) × (revenue / orders), so
ln(R₂/R₁) = ln(S₂/S₁) + ln(C₂/C₁) + ln(A₂/A₁) exactly. By segment (channel, device) the
change in dollars is split with the log-mean Divisia index: each segment's change
R₂ₛ − R₁ₛ is divided among sessions, conversion and AOV in proportion to their log ratios,
weighted by L(R₂ₛ, R₁ₛ) = (R₂ₛ − R₁ₛ) / (ln R₂ₛ − ln R₁ₛ). The parts sum to the total change
exactly, and a test checks it. A segment with no orders in either period is merged into
`other` first. Intervals come from a bootstrap that resamples users (500 draws).

These periods differ by season. The decomposition says which term moved; it does not say why,
and nothing here is a causal claim.

## Experiments

The data contains no experiment. Everything in this section is a method check on real
traffic, and every effect is planted. The site and the README say so.

- **Population:** users with at least one session in P3 (28 days, the quietest period). Each
  user enters on the day of their first P3 session.
- **Outcomes:** converted (at least one order in P3) and revenue per user in P3.
- **Assignment:** deterministic hash of `user_pseudo_id` with a salt, 50/50.
- **Tests:** conversion with a two-proportion z-test (pooled standard error for the test,
  unpooled Wald interval for the difference), cross-checked by a permutation test. Revenue per
  user with Welch's t-test and a bootstrap interval, because revenue is heavy-tailed.

Pass rules, fixed now:

| Check | Rule |
|---|---|
| A/A, 1,000 splits | False-positive rate at α = 0.05 lies in the central 95% binomial band for 1,000 trials: 3.7% to 6.4%. Checked for conversion and for revenue |
| Planted lifts of 5%, 10%, 20% (relative), 1,000 runs each | The 95% interval contains the true difference in 93% to 97% of runs |
| CUPED | No pass rule. Covariate: sessions before P3 for conversion, revenue before P3 for revenue. Variance reduction is reported with a bootstrap interval, and with the share of users who have any history. It is expected to be small |
| Peeking, 28 daily looks, A/A | The naive false-positive rate is reported as measured. With an O'Brien–Fleming-shaped boundary calibrated to the actual information fractions, the false-positive rate must not exceed 6.4% |

A failed rule is reported as failed, investigated and explained. It is not tuned away.
Power and minimum detectable effect are computed from the real baseline rates.

## Reconciliation

The models only reshape the raw events, so these must match the raw files exactly: events,
users, sessions, and purchase events per day. Order count and revenue will be lower than the
raw purchase-event totals because of the collapsing rule; both sides and the gap are
published, never forced to match. Raw `purchase_revenue_in_usd` against the sum of item
revenue is reported as found.

## Comparing segments

Intervals are per estimate. Any statement that two segments differ uses a two-proportion test
with Holm's correction across the comparisons on that page.

## What changes or drops an analysis, decided now

- A cohort with fewer than 1,000 users is not shown.
- A channel with fewer than 30 orders is merged into `other` for conversion and revenue.
- If the closed funnel loses more than 10% of purchasing sessions, open counts are shown too.
- CUPED is reported even if the reduction is near zero.
- If session-level source would have changed a conclusion, that is said; it is not used.
- No finding is published without its interval and its n.
