/* Theme switch for Buyer Analytics.
 *
 * Runs in <head> so a stored choice is applied before first paint. The choice
 * is remembered in localStorage inside try/catch; with nothing stored the page
 * follows the system preference via the CSS media query.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "buyer-analytics-theme";
  var root = document.documentElement;

  function readStored() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      if (value === "light" || value === "dark") {
        return value;
      }
    } catch (err) {
      /* storage unavailable; fall back to the system preference */
    }
    return null;
  }

  function systemTheme() {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
    return "light";
  }

  function effectiveTheme() {
    return root.getAttribute("data-theme") || systemTheme();
  }

  function apply(theme) {
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
  }

  function remember(theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (err) {
      /* ignore storage failures */
    }
  }

  function updateButton(button) {
    if (!button) {
      return;
    }
    var dark = effectiveTheme() === "dark";
    var label = dark ? "Switch to light theme" : "Switch to dark theme";
    button.setAttribute("aria-pressed", dark ? "true" : "false");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    var text = button.querySelector("[data-theme-label]");
    if (text) {
      text.textContent = dark ? "Light" : "Dark";
    }
  }

  /* Apply any stored choice as early as possible. */
  apply(readStored());

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("theme-toggle");
    updateButton(button);

    if (button) {
      button.addEventListener("click", function () {
        var next = effectiveTheme() === "dark" ? "light" : "dark";
        apply(next);
        remember(next);
        updateButton(button);
      });
    }

    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        if (!readStored()) {
          updateButton(button);
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
