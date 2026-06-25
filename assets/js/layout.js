const currentPage = getCurrentPage();
const PAGE_TRANSITION_ENTER_MS = 1640;
const PAGE_TRANSITION_LEAVE_MS = 1480;

renderSiteHeader();
renderSiteFooter();
renderPageTransition();
setupMobileMenu();
setupHeaderScrollState();
setupHeaderOffset();
setupPageTransitions();
setupImageFallback();
setupSmoothFaqDetails();

function renderSiteHeader() {
  const mount = document.querySelector("[data-site-header]");
  if (!mount) return;

  const navigation = [
    {
      href: "passengers",
      label: "Пассажирам",
      pages: ["passengers.html", "search.html"],
      sections: [
        { href: "passengers#routes", label: "Поиск маршрута" },
        { href: "passengers#schedule", label: "Расписание" },
        { href: "passengers#stations", label: "Станции" }
      ]
    },
    {
      href: "information",
      label: "Информация",
      pages: ["information.html"],
      sections: [
        { href: "information#tickets", label: "Билеты" },
        { href: "information#contacts", label: "Контакты" }
      ]
    },
    {
      href: "about",
      label: "О нас",
      pages: ["about.html", "projects.html"],
      sections: [
        { href: "about#projects", label: "Проекты" },
        { href: "about#history", label: "История" }
      ]
    },
    { href: "support", label: "Поддержка", pages: ["support.html"] },
    { href: "join", label: "Присоединиться", pages: ["join.html"] }
  ];

  mount.outerHTML = `
    <header class="site-header">
      <div class="site-header-inner">
        <a class="brand" href="./" aria-label="Главная страница">
          <img src="assets/img/logo-compact.png" alt="Первомайские железные дороги">
        </a>
        <nav class="nav" id="primary-nav" aria-label="Основная навигация">
          ${navigation.map(renderNavigationLink).join("")}
        </nav>
        <div class="header-actions">
          <button class="menu-toggle" id="menu-toggle" type="button" aria-controls="primary-nav" aria-expanded="false" aria-label="Открыть меню">
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </div>
    </header>
  `;
}

function renderNavigationLink(item) {
  const isActive = item.pages.includes(currentPage);
  const linkClass = `nav-link${isActive ? " is-active" : ""}`;

  if (!item.sections?.length) {
    return `<a class="${linkClass}" href="${item.href}">${item.label}</a>`;
  }

  return `
    <div class="nav-item nav-item-has-menu">
      <a class="${linkClass}" href="${item.href}" aria-haspopup="true">${item.label}</a>
      <div class="nav-menu" aria-label="${item.label}">
        ${item.sections.map((section) => `<a class="nav-sub-link" href="${section.href}">${section.label}</a>`).join("")}
      </div>
    </div>
  `;
}

function setupMobileMenu() {
  const menuToggle = document.querySelector("#menu-toggle");
  const primaryNav = document.querySelector("#primary-nav");
  const siteHeader = document.querySelector(".site-header");
  if (!siteHeader || !menuToggle || !primaryNav) return;

  menuToggle.addEventListener("click", () => {
    setMobileMenuState(siteHeader, menuToggle, !siteHeader.classList.contains("is-menu-open"));
  });

  primaryNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      setMobileMenuState(siteHeader, menuToggle, false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMobileMenuState(siteHeader, menuToggle, false);
      menuToggle.focus({ preventScroll: true });
      return;
    }

    if (event.key === "Tab" && siteHeader.classList.contains("is-menu-open")) {
      keepMenuFocusInside(event, siteHeader);
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 960) {
      if (siteHeader.classList.contains("is-menu-open")) {
        setMobileMenuState(siteHeader, menuToggle, false);
      } else {
        syncMobileNavInteractivity(siteHeader);
      }
      return;
    }

    syncMobileNavInteractivity(siteHeader);
  });

  syncMobileNavInteractivity(siteHeader);
}

function setMobileMenuState(siteHeader, menuToggle, isOpen) {
  siteHeader.classList.toggle("is-menu-open", isOpen);
  document.documentElement.classList.toggle("is-site-menu-open", isOpen);
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
  syncMobileNavInteractivity(siteHeader);

  if (isOpen) {
    requestAnimationFrame(() => {
      siteHeader.querySelector(".nav a")?.focus({ preventScroll: true });
    });
  }
  window.dispatchEvent(new Event("resize"));
}

function syncMobileNavInteractivity(siteHeader) {
  const primaryNav = siteHeader.querySelector("#primary-nav");
  if (!primaryNav) return;

  const shouldDisable = window.innerWidth <= 960 && !siteHeader.classList.contains("is-menu-open");
  primaryNav.inert = shouldDisable;

  if (shouldDisable) {
    primaryNav.setAttribute("aria-hidden", "true");
  } else {
    primaryNav.removeAttribute("aria-hidden");
  }
}

function keepMenuFocusInside(event, siteHeader) {
  const focusable = [...siteHeader.querySelectorAll("a[href], button:not([disabled])")]
    .filter((element) => element.offsetParent !== null);

  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable.at(-1);

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function setupHeaderScrollState() {
  const siteHeader = document.querySelector(".site-header");
  if (!siteHeader) return;

  const updateHeaderState = () => {
    siteHeader.classList.toggle("is-scrolled", window.scrollY > 8);
  };

  updateHeaderState();
  window.addEventListener("scroll", updateHeaderState, { passive: true });
}

function setupHeaderOffset() {
  const siteHeader = document.querySelector(".site-header");
  if (!siteHeader) return;

  const updateHeaderOffset = () => {
    document.documentElement.style.setProperty("--header-offset", `${siteHeader.offsetHeight}px`);
  };

  updateHeaderOffset();
  window.addEventListener("load", updateHeaderOffset);
  window.addEventListener("resize", updateHeaderOffset);

  if ("ResizeObserver" in window) {
    new ResizeObserver(updateHeaderOffset).observe(siteHeader);
  }
}

function renderSiteFooter() {
  const mount = document.querySelector("[data-site-footer]");
  if (!mount) return;

  mount.outerHTML = `
    <footer class="footer">
      <div class="container footer-grid">
        <div class="footer-brand">
          <img src="assets/img/logo-wide.png" alt="Первомайские железные дороги">
          <p>© 2026 «Первомайские железные дороги».</p>
        </div>
        <div class="footer-info" aria-label="Справочная информация">
          <div class="footer-block">
            <span>Период работы</span>
            <strong>Отсутствует.</strong>
          </div>
          <div class="footer-block">
            <span>Часы работы</span>
            <strong>ежедневно<br>с 9:00 до 21:00</strong>
          </div>
          <div class="footer-block">
            <span>Контактная информация</span>
            <a class="footer-contact-line footer-mail" href="mailto:info@mayrail.xyz">
              <span class="contact-icon contact-icon-mail" aria-hidden="true"></span>
              <strong>info@mayrail.xyz</strong>
            </a>
            <div class="footer-contact-line">
              <span class="contact-icon contact-icon-headquarters" aria-hidden="true"></span>
              <strong>ст. Первомайск</strong>
            </div>
          </div>
        </div>
      </div>
    </footer>
  `;
}

function renderPageTransition() {
  const hasTransitionIntent = hasStoredTransitionIntent();

  document.body.insertAdjacentHTML("beforeend", `
    <div class="page-transition" id="page-transition" aria-hidden="true">
      <img class="page-transition-logo" src="assets/img/logo-wide.png" alt="">
    </div>
  `);

  if (!hasTransitionIntent) {
    document.documentElement.classList.remove("is-page-transition-pending");
    return;
  }

  const transition = document.querySelector("#page-transition");
  transition?.classList.add("is-entering");
  document.documentElement.classList.remove("is-page-transition-active", "is-page-transition-pending");
  finishEnterTransitionWhenReady(transition);
}

function setupPageTransitions() {
  window.MayrailPageTransition = {
    navigate: startPageTransition
  };

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || !shouldAnimateLink(event, link)) return;

    event.preventDefault();
    startPageTransition(link.href);
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;

    const transition = document.querySelector("#page-transition");
    transition?.classList.remove("is-leaving");
    document.documentElement.classList.remove("is-page-transition-active", "is-page-transition-pending");
    transition?.classList.remove("is-entering");
  });
}

function setupImageFallback() {
  const fallbackSrc = "assets/img/placeholder.png";

  const applyFallback = (image) => {
    if (!(image instanceof HTMLImageElement)) return;
    if (image.getAttribute("src") === fallbackSrc) {
      image.dataset.fallbackApplied = "true";
      return;
    }

    const attempted = new Set((image.dataset.fallbackAttempted || "").split("|").filter(Boolean));
    const currentSrc = image.getAttribute("src") || "";
    if (currentSrc) attempted.add(currentSrc);

    const candidates = (image.dataset.fallbackCandidates || "")
      .split("|")
      .map((src) => src.trim())
      .filter(Boolean);
    const nextSrc = candidates.find((src) => !attempted.has(src));

    if (nextSrc) {
      image.dataset.fallbackAttempted = [...attempted].join("|");
      image.src = nextSrc;
      return;
    }

    image.dataset.fallbackApplied = "true";
    image.src = fallbackSrc;
  };

  document.addEventListener("error", (event) => {
    applyFallback(event.target);
  }, true);

  const checkLoadedImages = () => {
    document.querySelectorAll("img").forEach((image) => {
      if (image.complete && image.naturalWidth === 0) {
        applyFallback(image);
      }
    });
  };

  checkLoadedImages();
  window.addEventListener("load", checkLoadedImages, { once: true });
}

function setupSmoothFaqDetails() {
  const items = [...document.querySelectorAll("details.faq-item")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  items.forEach((details) => {
    const summary = details.querySelector("summary");
    if (!summary || typeof details.animate !== "function") return;

    summary.addEventListener("click", (event) => {
      if (reducedMotion.matches) return;

      event.preventDefault();
      toggleFaqDetails(details, summary);
    });
  });
}

function toggleFaqDetails(details, summary) {
  if (details.open) {
    closeFaqDetails(details, summary);
    return;
  }

  closeSiblingFaqDetails(details);
  openFaqDetails(details);
}

function closeSiblingFaqDetails(activeDetails) {
  const group = activeDetails.closest(".faq-list");
  if (!group) return;

  group.querySelectorAll("details.faq-item[open]").forEach((details) => {
    if (details === activeDetails) return;

    const summary = details.querySelector("summary");
    if (!summary) {
      details.open = false;
      return;
    }

    closeFaqDetails(details, summary);
  });
}

function openFaqDetails(details) {
  cancelFaqAnimation(details);

  const startHeight = details.getBoundingClientRect().height;
  details.open = true;
  const endHeight = details.scrollHeight;

  animateFaqDetails(details, startHeight, endHeight, () => {
    details.open = true;
  });
}

function closeFaqDetails(details, summary) {
  cancelFaqAnimation(details);

  const startHeight = details.getBoundingClientRect().height;
  const endHeight = getClosedFaqHeight(details, summary);

  animateFaqDetails(details, startHeight, endHeight, () => {
    details.open = false;
  });
}

function animateFaqDetails(details, startHeight, endHeight, onFinish) {
  if (Math.abs(startHeight - endHeight) < 1) {
    onFinish();
    return;
  }

  details.classList.add("is-animating");
  details.style.height = `${startHeight}px`;
  details.style.overflow = "hidden";

  const animation = details.animate([
    { height: `${startHeight}px` },
    { height: `${endHeight}px` }
  ], {
    duration: 340,
    easing: "cubic-bezier(0.22, 0.61, 0.36, 1)"
  });

  details._faqAnimation = animation;

  animation.onfinish = () => {
    onFinish();
    cleanupFaqAnimation(details);
  };

  animation.oncancel = () => {
    cleanupFaqAnimation(details);
  };
}

function cancelFaqAnimation(details) {
  if (!details._faqAnimation) return;

  details._faqAnimation.onfinish = null;
  details._faqAnimation.oncancel = null;
  details._faqAnimation.cancel();
  cleanupFaqAnimation(details);
}

function cleanupFaqAnimation(details) {
  details.classList.remove("is-animating");
  details.style.height = "";
  details.style.overflow = "";
  details._faqAnimation = null;
}

function getClosedFaqHeight(details, summary) {
  const styles = window.getComputedStyle(details);
  const borderHeight = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
  return summary.getBoundingClientRect().height + borderHeight;
}

function shouldAnimateLink(event, link) {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.target && link.target !== "_self") return false;
  if (link.hasAttribute("download")) return false;

  const url = new URL(link.href, window.location.href);
  if (!["http:", "https:", "file:"].includes(url.protocol)) return false;
  if (url.origin !== window.location.origin) return false;

  const isSamePath = url.pathname === window.location.pathname && url.search === window.location.search;
  if (isSamePath && url.hash) return false;
  if (url.href === window.location.href) return false;

  return true;
}

function startPageTransition(destination) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.location.href = destination;
    return;
  }

  const transition = document.querySelector("#page-transition");
  if (!transition) {
    window.location.href = destination;
    return;
  }

  if (transition.classList.contains("is-leaving")) return;

  storeTransitionIntent();
  document.documentElement.classList.add("is-page-transition-active");
  transition.classList.add("is-leaving");
  window.setTimeout(() => {
    window.location.href = destination;
  }, PAGE_TRANSITION_LEAVE_MS);
}

function finishEnterTransitionWhenReady(transition) {
  let isFinished = false;

  const finish = () => {
    if (isFinished) return;
    isFinished = true;
    transition?.classList.remove("is-entering");
    document.documentElement.classList.remove("is-page-transition-active");
  };

  const handleAnimationEnd = (event) => {
    if (event.animationName !== "page-transition-shell-out") return;
    transition?.removeEventListener("animationend", handleAnimationEnd);
    finish();
  };

  transition?.addEventListener("animationend", handleAnimationEnd);

  window.setTimeout(finish, PAGE_TRANSITION_ENTER_MS + 80);
}

function storeTransitionIntent() {
  try {
    sessionStorage.setItem("mayrail-page-transition", "1");
  } catch (error) {
    return;
  }
}

function hasStoredTransitionIntent() {
  try {
    const hasIntent = sessionStorage.getItem("mayrail-page-transition") === "1";
    sessionStorage.removeItem("mayrail-page-transition");
    return hasIntent;
  } catch (error) {
    return false;
  }
}

function getCurrentPage() {
  const page = window.location.pathname.split("/").filter(Boolean).pop();
  if (!page) return "index.html";
  return page.includes(".") ? page : `${page}.html`;
}
