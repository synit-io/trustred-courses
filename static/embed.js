(() => {
  try {
    const closeNav = (nav) => {
      nav.setAttribute("data-open", "false");
      nav.querySelector("[data-site-nav-toggle='true']")?.setAttribute(
        "aria-expanded",
        "false",
      );
    };

    const initSiteNav = () => {
      document.querySelectorAll(".site-nav").forEach((nav) => {
        const toggle = nav.querySelector("[data-site-nav-toggle='true']");
        if (!(toggle instanceof HTMLElement)) return;

        toggle.addEventListener("click", () => {
          const isOpen = nav.getAttribute("data-open") === "true";
          nav.setAttribute("data-open", String(!isOpen));
          toggle.setAttribute("aria-expanded", String(!isOpen));
        });

        nav.querySelectorAll("a").forEach((link) => {
          link.addEventListener("click", () => closeNav(nav));
        });

        nav.querySelectorAll("form").forEach((form) => {
          form.addEventListener("submit", () => closeNav(nav));
        });
      });

      document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Node)) return;

        document.querySelectorAll(".site-nav[data-open='true']").forEach((
          nav,
        ) => {
          if (!nav.contains(target)) {
            closeNav(nav);
          }
        });
      });
    };

    initSiteNav();

    if (globalThis.self === globalThis.top) return;

    const applyEmbeddedClass = () => {
      document.documentElement.classList.add("embedded");
      if (document.body) document.body.classList.add("embedded");
    };

    const sendHeight = () => {
      const bodyHeight = document.body?.scrollHeight ?? 0;
      const docHeight = document.documentElement.scrollHeight;
      const height = Math.max(bodyHeight, docHeight);

      globalThis.parent.postMessage(
        {
          type: "aid-org-courses:resize",
          height,
        },
        "*",
      );
    };

    applyEmbeddedClass();
    globalThis.addEventListener("load", () => {
      applyEmbeddedClass();
      sendHeight();
    });
    globalThis.addEventListener("resize", sendHeight);

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(sendHeight);
      if (document.body) {
        observer.observe(document.body);
      } else {
        observer.observe(document.documentElement);
      }
    }

    setTimeout(sendHeight, 0);
    setTimeout(sendHeight, 250);
  } catch {
    // Keep embed helper non-blocking.
  }
})();
