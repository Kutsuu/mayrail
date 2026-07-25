(() => {
  "use strict";

  const client = window.MAYRAIL_FIREBASE_CONTENT;
  const HISTORY_IMAGE_PLACEHOLDER = "assets/img/placeholder.png";
  if (!client) return;

  const vacancyList = document.querySelector("[data-vacancy-list]");
  const historyTimeline = document.querySelector("[data-history-timeline]");
  const passengerInfo = document.querySelector("[data-passenger-info]");
  const cargoFaq = document.querySelector("[data-cargo-faq]");
  const companyContact = document.querySelector("[data-company-contact]");

  if (vacancyList) void loadVacancies(vacancyList);
  if (historyTimeline) void loadHistory(historyTimeline);
  if (passengerInfo) void loadPassengerInfo(passengerInfo);
  if (cargoFaq) void loadCargoFaq(cargoFaq);
  if (companyContact) void loadCompanyContact(companyContact);

  async function loadVacancies(container) {
    try {
      const items = await publishedItems("vacancies");
      container.innerHTML = items.length
        ? items.map(renderVacancy).join("")
        : '<div class="empty-state">Открытых вакансий сейчас нет.</div>';
    } catch (error) {
      console.error("Vacancies are unavailable", error);
    }
  }

  function renderVacancy(item) {
    const tasks = listSection("Задачи", item.tasks);
    const requirements = listSection("Требования", item.requirements);
    const image = item.image
      ? `<img class="job-card-media" src="${escapeHtml(publicImageUrl(item.image))}" alt="${escapeHtml(item.imageAlt || item.title)}" loading="lazy" decoding="async">`
      : "";
    return `
      <article class="job-card job-vacancy-card">
        ${image}
        <div class="job-card-body">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.body)}</p>
          ${tasks}
          ${requirements}
        </div>
      </article>
    `;
  }

  async function loadHistory(container) {
    try {
      const items = await publishedItems("history");
      container.innerHTML = items.length
        ? items.map(renderHistoryItem).join("")
        : '<div class="empty-state">История пока не опубликована.</div>';
      setupHistoryImageFallback(container);
    } catch (error) {
      console.error("History is unavailable", error);
    }
  }

  function renderHistoryItem(item) {
    const image = publicImageUrl(item.image);
    const hasImage = Boolean(image);
    const imageMarkup = `
      <img
        class="timeline-item-image${hasImage ? "" : " is-placeholder"}"
        src="${escapeHtml(image || HISTORY_IMAGE_PLACEHOLDER)}"
        alt="${hasImage ? escapeHtml(item.imageAlt || "") : ""}"
        loading="lazy"
        decoding="async"
        data-history-image
      >`;
    const paragraphs = String(item.body || "")
      .split(/\n\s*\n/)
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => `<p>${escapeHtml(value)}</p>`)
      .join("");
    return `
      <article class="timeline-item">
        ${imageMarkup}
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          ${paragraphs}
        </div>
      </article>
    `;
  }

  function setupHistoryImageFallback(container) {
    container.querySelectorAll("img[data-history-image]").forEach((image) => {
      const applyFallback = () => {
        if (image.dataset.historyFallbackApplied === "true") return;
        image.dataset.historyFallbackApplied = "true";
        image.classList.add("is-placeholder");
        if (image.getAttribute("src") !== HISTORY_IMAGE_PLACEHOLDER) {
          image.src = HISTORY_IMAGE_PLACEHOLDER;
        }
      };
      image.addEventListener("error", applyFallback, { once: true });
      if (image.complete && image.naturalWidth === 0) applyFallback();
    });
  }

  function publicImageUrl(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    const fileMatch = source.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    const idMatch = source.match(/[?&]id=([^&]+)/i);
    const id = fileMatch?.[1] || idMatch?.[1];
    return id
      ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200`
      : source;
  }

  function listSection(title, values) {
    const items = Array.isArray(values)
      ? values.map(value => String(value || "").trim()).filter(Boolean)
      : [];
    if (!items.length) return "";
    return `
      <div class="job-card-section">
        <h4>${escapeHtml(title)}</h4>
        <ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    `;
  }

  async function loadPassengerInfo(container) {
    try {
      const items = await publishedItems("passengerInfo");
      const tickets = items.filter(item => item.category === "tickets");
      const rules = items.filter(item => item.category === "rules");
      const faq = items.filter(item => item.category === "faq");
      container.innerHTML = `
        <div class="ticket-guide-columns">
          ${renderPassengerList("Главное о поездке", tickets)}
          ${renderPassengerList("Правила поведения в поезде", rules)}
        </div>
        ${renderFaq(faq)}
      `;
    } catch (error) {
      console.error("Passenger information is unavailable", error);
    }
  }

  function renderPassengerList(title, items) {
    return `
      <div class="ticket-guide-block">
        <h3>${escapeHtml(title)}</h3>
        ${items.length
          ? `<ul class="ticket-point-list">${items.map(item => `
              <li><strong>${escapeHtml(item.title)}</strong>${item.body ? ` ${escapeHtml(item.body)}` : ""}</li>
            `).join("")}</ul>`
          : '<div class="empty-state">Информация пока не опубликована.</div>'}
      </div>
    `;
  }

  function renderFaq(items) {
    if (!items.length) return "";
    return `
      <div class="ticket-faq">
        ${renderFaqContent(items)}
      </div>
    `;
  }

  function renderFaqContent(items) {
    if (!items.length) {
      return '<div class="empty-state">Вопросы пока не опубликованы.</div>';
    }
    return `
        <h3>Часто задаваемые вопросы</h3>
        <div class="faq-list">
          ${items.map(item => `
            <details class="faq-item">
              <summary>${escapeHtml(item.title)}</summary>
              <p>${escapeHtml(item.body)}</p>
            </details>
          `).join("")}
        </div>
    `;
  }

  async function loadCargoFaq(container) {
    try {
      const items = (await publishedItems("passengerInfo"))
        .filter(item => item.category === "cargoFaq");
      container.innerHTML = renderFaqContent(items);
    } catch (error) {
      console.error("Cargo FAQ is unavailable", error);
    }
  }

  async function loadCompanyContact(container) {
    try {
      const items = await publishedItems("companyInfo");
      const values = new Map(items.map(item => [
        item.category,
        String(item.body || "").trim()
      ]));
      const email = values.get("email");
      const location = values.get("location");
      const emailLink = container.querySelector("[data-company-email-link]");
      const emailText = container.querySelector("[data-company-email]");
      const locationText = container.querySelector("[data-company-location]");
      if (email && emailText) emailText.textContent = email;
      if (email && emailLink) emailLink.href = `mailto:${email}`;
      if (location && locationText) locationText.textContent = location;
    } catch (error) {
      console.error("Contact information is unavailable", error);
    }
  }

  async function publishedItems(kind) {
    const loaded = await client.load(kind);
    return (Array.isArray(loaded) ? loaded : [])
      .filter(item => item?.published === true)
      .sort((left, right) =>
        Number(left.order || 0) - Number(right.order || 0) ||
        String(left.title || "").localeCompare(String(right.title || ""), "ru")
      );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
