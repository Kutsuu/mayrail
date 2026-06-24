try {
  if (sessionStorage.getItem("mayrail-page-transition") === "1") {
    document.documentElement.classList.add("is-page-transition-pending");
  }
} catch (error) {}
