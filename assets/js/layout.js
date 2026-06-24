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

function renderSiteHeader() {
  const mount = document.querySelector("[data-site-header]");
  if (!mount) return;

  const navigation = [
    { href: "passengers", label: "Пассажирам", pages: ["passengers.html", "search.html"] },
    { href: "business", label: "Предпринимателям", pages: ["business.html"] },
    { href: "about", label: "О нас", pages: ["about.html"] },
    { href: "projects", label: "Проекты", pages: ["projects.html"] },
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
  return `<a${isActive ? ' class="is-active"' : ""} href="${item.href}">${item.label}</a>`;
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
    }
  });
}

function setMobileMenuState(siteHeader, menuToggle, isOpen) {
  siteHeader.classList.toggle("is-menu-open", isOpen);
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
  window.dispatchEvent(new Event("resize"));
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
            <a class="footer-mail" href="mailto:info@mayrail.pro">
              <img src="assets/icons/mail.svg" alt="" aria-hidden="true">
              <strong>info@mayrail.pro</strong>
            </a>
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
