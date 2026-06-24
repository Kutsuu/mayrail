(() => {
  const source = window.MAYRAIL_NEWS || { posts: [] };
  const posts = Array.isArray(source.posts)
    ? source.posts.filter(isPublishedPost).sort(sortPostsByDate)
    : [];

  document.querySelectorAll("[data-news-list]").forEach((container) => {
    renderNewsList(container, posts, Number(container.dataset.newsLimit) || posts.length);
  });

  const detailContainer = document.querySelector("[data-news-detail]");
  if (detailContainer) {
    renderNewsPage(detailContainer, posts);
  }

function isPublishedPost(post) {
  return post && post.published !== false && post.id && post.title;
}

function sortPostsByDate(a, b) {
  return dateValue(b.date) - dateValue(a.date);
}

function dateValue(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function renderNewsList(container, posts, limit) {
  const visiblePosts = posts.slice(0, limit);

  if (!visiblePosts.length) {
    container.innerHTML = `<div class="empty-state news-empty">Новости пока не опубликованы.</div>`;
    return;
  }

  container.innerHTML = visiblePosts.map(renderNewsCard).join("");
}

function renderNewsPage(container, posts) {
  const id = new URLSearchParams(window.location.search).get("id");
  const title = document.querySelector("[data-news-page-title]");

  if (!id) {
    if (title) title.textContent = "Новости";
    if (title) title.hidden = false;
    container.classList.add("news-grid");
    renderNewsList(container, posts, posts.length);
    return;
  }

  const post = posts.find((item) => item.id === id);
  container.classList.remove("news-grid");
  if (title) title.hidden = true;

  if (!post) {
    container.innerHTML = `
      <article class="news-article">
        <h1 class="news-title">Новость не найдена</h1>
        <div class="empty-state">Такой новости нет или она еще не опубликована.</div>
      </article>
    `;
    return;
  }

  document.title = `ПЖД | ${post.title}`;
  container.innerHTML = renderNewsArticle(post);
}

function renderNewsCard(post) {
  return `
    <a class="news-card" href="news?id=${encodeURIComponent(post.id)}">
      ${renderNewsImage(post)}
      <div class="news-card-body">
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.excerpt || getContent(post)[0] || "")}</p>
        <p class="news-meta">${escapeHtml(formatNewsDate(post.date))}</p>
      </div>
    </a>
  `;
}

function renderNewsArticle(post) {
  return `
    <article class="news-article">
      <h1 class="news-title">${escapeHtml(post.title)}</h1>
      <p class="news-meta">${escapeHtml(formatNewsDate(post.date))}</p>
      ${renderNewsImage(post, "news-article-image")}
      <div class="news-body">
        ${getContent(post).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      </div>
    </article>
  `;
}

function renderNewsImage(post, className = "news-card-image") {
  if (!post.image) return "";

  return `
    <img class="${className}" src="${escapeHtml(post.image)}" alt="${escapeHtml(post.imageAlt || post.title)}" loading="lazy">
  `;
}

function getContent(post) {
  if (Array.isArray(post.content)) {
    return post.content.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(post.content || "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatNewsDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Без даты";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
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
