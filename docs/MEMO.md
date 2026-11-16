# Memo: what I would change, and why

**For:** the product manager of the Google Merchandise Store
**Basis:** three months of event data, 1 November 2020 to 31 January 2021. Numbers and
intervals are in `docs/FINDINGS.md`.

## Do first

**1. Fix purchase tracking before trusting any revenue chart.**
Summing purchase events overstates revenue by 6.6% ($24,057), because events repeat. 906
purchase events have no transaction id. In the last four weeks 24% of orders record zero
revenue, against 3% before. Until this is fixed, every revenue trend carries an error larger
than most changes you would want to detect.

**2. Stop reading the funnel inside one session.**
41% of purchasing sessions skip an earlier step, because people fill a cart and come back to
pay. The single-session funnel shows 2,848 purchases where there were 4,848 purchasing
sessions. Track the funnel per user across sessions, and drop "add shipping info" as a step:
it fires with checkout every time.

**3. Put the product effort before the cart.**
Of sessions that view an item, 19.7% add one to the cart. Checkout loses fewer: 65% of
checkouts reach payment and 74% of those complete. The product page and the add-to-cart
decision are where most sessions end.

## Change how tests are run

**4. Only test changes you expect to be large.**
At January traffic, a four-week test on conversion can detect an 18% relative lift and
nothing smaller. A 5% lift would need about 12 times the traffic. Small copy and colour tests
on purchase conversion will come back inconclusive; run fewer, bigger tests.

**5. Do not stop a test the first day it looks significant.**
On this traffic, checking daily and stopping at the first significant day declares a winner
27% of the time when there is no difference at all. Either test once at the planned end, or
use the sequential boundary in this repo, which held false wins at 4.9%.

**6. Skip CUPED here.**
Only 4% of users have any earlier visit, so it removes about 1% of the variance.

## Do not act on

- **Mobile versus desktop.** They convert the same (0.82% and 0.77%, no significant
  difference). There is no case here for a mobile checkout rebuild.
- **Paid search versus organic.** They convert the same (1.53% each). Without cost data that
  says nothing about return on spend.
- **The January drop in order value.** Most of it is the zero-revenue tracking problem.
  Orders with revenue fell from $69.68 to $63.44, not to $48.

## What I cannot tell you

Why conversion halved after the holidays. Sessions fell 12% while orders per session fell
from 1.94% to 1.02%. That is what happened; the data has no experiment and no prior year, so
it cannot separate season from anything the store changed.
