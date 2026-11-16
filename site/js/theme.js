/* Theme control for Buyer Analytics.
 *
 * Three states: follow the system, force light, force dark. The choice is
 * stored in localStorage inside try/catch so private mode never throws. This
 * file runs from <head>, so the stored choice is applied before first paint and
 * the "js" class is added while the document is still parsing.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "buyer-analytics-theme";
  var ORDER = ["system", "light", "dark"];
  var LABELS = { system: "System", light: "Light", dark: "Dark" };
  var root = document.documentElement;

  /* A class the CSS can key on, so no-JS users never see reveal animations. */
  root.classList.add("js");

  function readStored() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      if (value === "system" || value === "light" || value === "dark") {
        return value;
      }
    } catch (err) {
      /* storage unavailable; fall back to the system preference */
    }
    return "system";
  }

  function apply(mode) {
    if (mode === "light" || mode === "dark") {
      root.setAttribute("data-theme", mode);
    } else {
      root.removeAttribute("data-theme");
    }
  }

  function remember(mode) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (err) {
      /* ignore storage failures */
    }
  }

  function updateButton(button, mode) {
    if (!button) {
      return;
    }
    var next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    var label =
      "Theme: " + LABELS[mode] + ". Activate to switch to " + LABELS[next] + ".";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("data-mode", mode);
    var text = button.querySelector("[data-theme-label]");
    if (text) {
      text.textContent = LABELS[mode];
    }
  }

  var mode = readStored();
  apply(mode);

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("theme-toggle");
    updateButton(button, mode);

    if (button) {
      button.addEventListener("click", function () {
        mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
        apply(mode);
        remember(mode);
        updateButton(button, mode);
      });
    }

    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        if (mode === "system") {
          updateButton(button, mode);
        }
      };
      if (query.addEventListener) {
        query.addEventListener("change", onChange);
      } else if (query.addListener) {
        query.addListener(onChange);
      }
    }
  });
})();
