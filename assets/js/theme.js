const themeToggle = document.querySelector("#theme-toggle");
const menuToggle = document.querySelector("#menu-toggle");
const primaryNav = document.querySelector("#primary-nav");
const siteHeader = document.querySelector(".site-header");
const THEME_STORAGE_KEY = "mayrail-theme";

setupThemeToggle();
setupMobileMenu();
setupHeaderScrollState();
setupHeaderOffset();

function setupThemeToggle() {
  if (!themeToggle) return;

  applyTheme(getCurrentTheme(), false);
  themeToggle.addEventListener("click", () => {
    applyTheme(getCurrentTheme() === "dark" ? "light" : "dark");
  });
}

function getCurrentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme, shouldStore = true) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  themeToggle.setAttribute("aria-label", theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему");

  if (!shouldStore) return;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn("Theme preference was not saved.", error);
  }
}

function setupMobileMenu() {
  if (!siteHeader || !menuToggle || !primaryNav) return;

  menuToggle.addEventListener("click", () => {
    setMobileMenuState(!siteHeader.classList.contains("is-menu-open"));
  });

  primaryNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      setMobileMenuState(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMobileMenuState(false);
    }
  });
}

function setMobileMenuState(isOpen) {
  siteHeader.classList.toggle("is-menu-open", isOpen);
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
  window.dispatchEvent(new Event("resize"));
}

function setupHeaderScrollState() {
  if (!siteHeader) return;

  const updateHeaderState = () => {
    siteHeader.classList.toggle("is-scrolled", window.scrollY > 8);
  };

  updateHeaderState();
  window.addEventListener("scroll", updateHeaderState, { passive: true });
}

function setupHeaderOffset() {
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
