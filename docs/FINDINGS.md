# Findings

Every number here is in `artefacts/` and was produced by the code in this repo. Rates carry
95% intervals and their n. The method was fixed in `ANALYSIS_PLAN.md` before any of this was
computed. Data: Google Merchandise Store, 1 November 2020 to 31 January 2021.

## 1. The store converts about 1 session in 74, and the raw revenue is overstated by 6.6%

- 360,129 sessions, 270,154 users (browser cookies), 5,279 orders, $338,108.
- Session conversion 1.35% (1.31% to 1.38%, n = 360,129). User conversion 1.64% (1.59% to
  1.68%, n = 270,154).
- AOV $64.05 (61.92 to 66.56, n = 4,419 buyers).
- The raw export has 5,692 purchase events. Collapsing repeats leaves 5,279 orders, 413 fewer,
  and $338,108 instead of $362,165. Summing the raw events would overstate revenue by $24,057.

**Caveat:** 906 purchase events have no transaction id, so they can only be collapsed per
session. A different rule would move the order count.

## 2. The largest loss is before the cart, and the single-session funnel misleads

Closed funnel (each step needs the one before it, inside one session):

| Step | Sessions | Rate from previous step |
|---|---|---|
| View item | 77,020 | 21.39% of all sessions (21.25% to 21.52%) |
| Add to cart | 15,173 | 19.70% (19.42% to 19.98%, n = 77,020) |
| Begin checkout | 5,959 | 39.27% (38.50% to 40.05%, n = 15,173) |
| Add shipping info | 5,959 | 100% |
| Add payment info | 3,858 | 64.74% (63.52% to 65.95%, n = 5,959) |
| Purchase | 2,848 | 73.82% (72.41% to 75.18%, n = 3,858) |

Four in five sessions that view an item never add one to the cart.

**What did not hold up:** 41.25% of purchasing sessions (39.88% to 42.65%, n = 4,848) skip
at least one earlier step. Counting each step on its own gives 11,106 checkout sessions and
4,848 purchasing sessions, against 5,959 and 2,848 in the closed funnel. People fill a cart in
one session and pay in another, so a funnel measured inside one session understates every
later step. The plan's rule for this case applies: both counts are published. Shipping info
fires with checkout in every session, so it is not a real step in this data.

## 3. Mobile converts like desktop

Session to purchase (closed funnel): desktop 0.77% (0.73% to 0.81%, n = 208,942), mobile
0.82% (0.78% to 0.87%, n = 143,185), tablet 0.77% (0.60% to 0.99%, n = 8,002). After Holm's
correction no pair differs (desktop against mobile p = 0.20). This data gives no evidence that
the mobile experience loses buyers.

## 4. Referral and undisclosed-source users buy more often; paid search does not beat organic

User conversion by first-touch channel:

| Channel | Users | Conversion | Holm p against organic search |
|---|---|---|---|
| Referral | 40,020 | 1.86% (1.73% to 2.00%) | 0.00004 |
| Undisclosed | 50,001 | 1.78% (1.67% to 1.90%) | 0.001 |
| Direct | 64,109 | 1.58% (1.48% to 1.68%) | 0.91 |
| Organic search | 101,742 | 1.53% (1.46% to 1.61%) | reference |
| Paid search | 14,282 | 1.53% (1.34% to 1.74%) | 0.97 |

**Caveats:** channel is the user's first touch, not the source of the buying session.
"Undisclosed" is 18.5% of users whose source Google redacted, so it cannot be acted on.
"Referral" includes the store's own domain as a referrer. There is no cost data, so nothing
here says whether paid search pays for itself.

## 5. Few users come back, and the repeat-purchase figure is not loyalty

- Share of a weekly cohort active again the next week: from 6.29% (5.95% to 6.64%,
  n = 19,374) for the 2 November cohort down to 2.46% (2.23% to 2.70%, n = 16,615) for the
  28 December cohort.
- 11.84% of buyers (10.80% to 12.96%, n = 3,447) order again within 28 days. The median gap
  is 0 days (0 to 1, n = 408): at least half of those second orders come the same day. That
  reads as split baskets or repeated transactions under new ids, not returning customers.

**Caveat:** a cookie is not a person, and the data is cut off on both sides. Retention is a
lower bound.

## 6. The holiday rise was traffic and conversion in equal parts; the January fall was conversion

Three 28-day periods fixed in the plan: P1 2 to 29 November, P2 30 November to 27 December,
P3 4 to 31 January. Log changes add up exactly.

| | Revenue | Total | Sessions | Conversion | AOV |
|---|---|---|---|---|---|
| P1 → P2 | +$53,627 | 0.398 (0.289 to 0.499) | 0.214 (0.203 to 0.225) | 0.224 (0.155 to 0.293) | −0.040 (−0.110 to 0.037) |
| P2 → P3 | −$109,031 | −1.102 (−1.242 to −0.971) | −0.125 (−0.136 to −0.115) | −0.640 (−0.718 to −0.559) | −0.337 (−0.439 to −0.236) |

Intervals: bootstrap over users, n = 167,025 and 182,981.

After the holidays sessions fell from 125,311 to 110,556 while orders per session fell from
1.94% to 1.02%. Traffic mostly stayed; buying did not. Conversion is 58% of the fall in log
terms.

**What did not hold up:** the AOV term. 24.20% of P3 orders (21.79% to 26.79%, n = 1,128)
carry zero revenue, against 3.38% in P2 (2.73% to 4.18%, n = 2,425) and 3.26% in P1. Among
orders with revenue, AOV moved from $69.68 to $63.44, not from $67.33 to $48.09. Most of the
AOV fall is a tracking problem in the last days of the export, not smaller baskets.

These periods differ by season. The split says which term moved, not why.

## 7. This store cannot detect small lifts in a month, and daily peeking would mislead it

No experiment exists in this data. Every effect below was planted on random splits of the
88,126 users active in P3, to check the method on real traffic.

- Baseline conversion 1.17% (1.10% to 1.24%). With 44,063 users per arm the smallest lift
  detectable at 80% power is 18.1% relative. A 5% lift needs 544,604 users per arm; at this
  traffic the test has 12.2% power.
- Pass rules set in the plan:

| Check | Result | Rule | |
|---|---|---|---|
| A/A false positives, conversion | 6.1% (4.8% to 7.8%) | 3.7% to 6.4% | PASS |
| A/A false positives, revenue per user | 5.0% (3.8% to 6.5%) | 3.7% to 6.4% | PASS |
| Interval coverage, planted 5% lift | 96.2% (94.8% to 97.2%) | 93% to 97% | PASS |
| Interval coverage, planted 10% lift | 95.4% (93.9% to 96.5%) | 93% to 97% | PASS |
| Interval coverage, planted 20% lift | 96.0% (94.6% to 97.0%) | 93% to 97% | PASS |
| Daily peeking with the boundary | 4.9% (3.7% to 6.4%) | at most 6.4% | PASS |

- Checking results every day and stopping at the first p < 0.05 gives 27.2% false wins
  (24.5% to 30.0%), against 4.1% when testing once at the end.
- CUPED removes 1.12% of the variance of conversion (0.77% to 1.48%) and 0.06% of revenue,
  because only 4.14% of users have any earlier visit. It is not worth running here.
- Cross-check on one fixed split: z-test p = 0.698, permutation test p = 0.708. Revenue
  difference interval: Welch −0.122 to 0.134, bootstrap −0.122 to 0.127.

**Limits of these checks:**

- The A/A rate for conversion passes at 6.1%, but its own interval reaches past the 6.4% edge.
- Planted lifts were tested for conversion only. Interval coverage for revenue was not tested.
- The peeking boundary is O'Brien–Fleming-shaped on the share of users who have entered. A
  user's outcome can still change after entry, so the 4.9% is a measured pass on this data,
  not a guarantee from theory.
- Simulation intervals are Wilson intervals over 1,000 runs.

## What this does not establish

- Nothing causal. No experiment was run, and the period comparison is seasonal.
- Nothing about people: users are cookies, and cross-device journeys are invisible.
- Nothing about channel return on spend, or about the source of individual sessions.
- Nothing beyond one retailer over three months that include Black Friday and Christmas.

## Where the build departed from the plan

- The revenue-decomposition segments merge into `other` when a segment has no orders in
  either one of the two periods. The plan's wording allowed both readings.
- The permutation and bootstrap cross-checks are reported for one fixed split, not for every
  simulated split.
