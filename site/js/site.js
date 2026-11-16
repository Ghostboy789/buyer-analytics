/* Shared browser behaviour: reveal on scroll, the glossary popover and the
 * compact navigation. Everything is progressive: with JavaScript off the page
 * still reads, because the renderers only add content that is visible by
 * default and the reveal class is only applied by this file.
 */
(function (global) {
  "use strict";

  var doc = global.document;
  var observer = null;
  var glossaryBound = false;
  var navBound = false;

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function prefersReducedMotion() {
    return Boolean(
      global.matchMedia &&
        global.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /* ---------------------------------------------------------------- */
  /* Reveal on scroll                                                  */
  /* ---------------------------------------------------------------- */

  function showAll(nodes) {
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].classList.add("is-in");
    }
  }

  function observe(root) {
    var scope = root || doc;
    var nodes = scope.querySelectorAll("[data-reveal]:not(.is-in)");
    if (!nodes.length) {
      return;
    }
    if (prefersReducedMotion() || typeof global.IntersectionObserver !== "function") {
      showAll(nodes);
      return;
    }
    if (!observer) {
      observer = new global.IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i += 1) {
            if (entries[i].isIntersecting) {
              entries[i].target.classList.add("is-in");
              observer.unobserve(entries[i].target);
            }
          }
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.04 }
      );
    }
    for (var j = 0; j < nodes.length; j += 1) {
      observer.observe(nodes[j]);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Glossary popover                                                  */
  /* ---------------------------------------------------------------- */

  function glossary() {
    if (glossaryBound) {
      return;
    }
    var pop = doc.getElementById("glossary-pop");
    if (!pop) {
      return;
    }
    glossaryBound = true;

    var termEl = pop.querySelector("[data-glossary-term]");
    var defEl = pop.querySelector("[data-glossary-def]");
    var current = null;

    function place(button) {
      var rect = button.getBoundingClientRect();
      pop.style.left = "0px";
      pop.style.top = "0px";
      var pw = pop.offsetWidth;
      var ph = pop.offsetHeight;
      var left = clamp(rect.left, 8, Math.max(8, global.innerWidth - pw - 8));
      var top = rect.bottom + 10;
      if (top + ph > global.innerHeight - 8) {
        top = Math.max(8, rect.top - ph - 10);
      }
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(top) + "px";
    }

    function close() {
      if (!current) {
        return;
      }
      current.setAttribute("aria-expanded", "false");
      current = null;
      pop.hidden = true;
      pop.removeAttribute("data-open");
    }

    function open(button) {
      var definitions = global.Glossary || {};
      var text = definitions[button.getAttribute("data-term")];
      if (!text) {
        return;
      }
      if (termEl) {
        termEl.textContent = button.textContent;
      }
      if (defEl) {
        defEl.textContent = text;
      }
      current = button;
      button.setAttribute("aria-expanded", "true");
      pop.hidden = false;
      pop.setAttribute("data-open", "");
      place(button);
    }

    doc.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest(".term") : null;
      if (button && button.getAttribute("data-term")) {
        if (button === current) {
          close();
        } else {
          close();
          open(button);
        }
        return;
      }
      if (current && !pop.contains(event.target)) {
        close();
      }
    });

    doc.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && current) {
        var button = current;
        close();
        button.focus();
      }
    });

    global.addEventListener("resize", function () {
      if (current) {
        place(current);
      }
    });
    global.addEventListener("scroll", function () {
      if (current) {
        place(current);
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Compact navigation                                                */
  /* ---------------------------------------------------------------- */

  function nav() {
    if (navBound) {
      return;
    }
    var toggle = doc.querySelector("[data-nav-toggle]");
    var panel = doc.getElementById("site-nav");
    if (!toggle || !panel) {
      return;
    }
    navBound = true;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      panel.classList.toggle("is-open", open);
    }

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    doc.addEventListener("click", function (event) {
      if (toggle.getAttribute("aria-expanded") !== "true") {
        return;
      }
      if (toggle.contains(event.target) || panel.contains(event.target)) {
        return;
      }
      setOpen(false);
    });

    doc.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  function init(root) {
    observe(root || doc);
    glossary();
    nav();
  }

  if (doc) {
    doc.addEventListener("DOMContentLoaded", function () {
      init(doc);
    });
  }

  var api = {
    init: init,
    observe: observe,
    glossary: glossary,
    nav: nav
  };

  if (typeof window !== "undefined") {
    window.Site = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
