/* Plain-English glossary for the Buyer Analytics site.
 *
 * One sentence per term, taken from the wording of ANALYSIS_PLAN.md. Pure data,
 * so it loads under Node and in the browser.
 */
(function (global) {
  "use strict";

  var GLOSSARY = {
    session:
      "One visit: one browser cookie paired with one GA4 session id, dated by the UTC date of its first event.",
    user:
      "One browser cookie, not a person; cross-device behaviour cannot be joined because the user id is always empty.",
    conversion:
      "The share of sessions, or of active users, that place at least one order in the period.",
    aov:
      "Average order value: revenue divided by orders, with zero-revenue orders included in the count.",
    interval:
      "A 95% interval is the range that would contain the true value in 95% of repeated samples of the same size.",
    closed_funnel:
      "A funnel step counted only when every earlier step happened in the same session.",
    aa_test:
      "A test that splits users into two identical arms; any result it calls significant is a false positive.",
    peeking:
      "Looking at a test again and again and stopping at the first significant result, which inflates the false-positive rate.",
    cuped:
      "A variance-reduction method that uses a pre-period covariate to make an experiment more sensitive at the same sample size.",
    holm:
      "Holm's correction: a way of adjusting p-values when several comparisons are tested at once, so the chance of any false positive stays at 5%."
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = GLOSSARY;
  }
  if (typeof window !== "undefined") {
    window.Glossary = GLOSSARY;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
