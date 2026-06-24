(() => {
  const NEWS_CACHE_TTL_MS = 2 * 60 * 1000;
  const NEWS_CACHE_PREFIX = "mayrail-news-data-v1:";
  const NEWS_EXCERPT_LIMIT = 230;
  const NEWS_LOAD_ERROR = "Новости сейчас недоступны. Пожалуйста, попробуйте позже.";

  initNews();

  async function initNews() {
    const listContainers = [...document.querySelectorAll("[data-news-list]")];
    const detailContainer = document.querySelector("[data-news-detail]");

    [...listContainers, detailContainer].filter(Boolean).forEach(renderNewsLoading);

    try {
      const posts = await loadNewsPosts();

      listContainers.forEach((container) => {
        renderNewsList(container, posts, Number(container.dataset.newsLimit) || posts.length);
      });

      if (detailContainer) {
        renderNewsPage(detailContainer, posts);
      }
    } catch (error) {
      console.error(error);
      listContainers.forEach(renderNewsError);

      if (detailContainer) {
        renderNewsError(detailContainer);
      }
    }
  }

  async function loadNewsPosts() {
    const source = window.MAYRAIL_NEWS || {};

    if (source.source) {
      const text = await fetchTextWithCache(source.source);
      return csvToNewsPosts(text).filter(isPublishedPost).sort(sortPostsByDate);
    }

    if (Array.isArray(source.posts)) {
      return source.posts.filter(isPublishedPost).sort(sortPostsByDate);
    }

    return [];
  }

  async function fetchTextWithCache(url) {
    const cached = readNewsCache(url);
    const isFresh = cached && Date.now() - cached.createdAt < NEWS_CACHE_TTL_MS;

    if (isFresh) {
      return cached.text;
    }

    const response = await fetch(url, { cache: "no-store" });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`News request failed: ${response.status} (${url})`);
    }

    writeNewsCache(url, text);
    return text;
  }

  function readNewsCache(url) {
    try {
      const rawValue = localStorage.getItem(getNewsCacheKey(url));
      if (!rawValue) return null;

      const cached = JSON.parse(rawValue);
      if (typeof cached.text !== "string" || !Number.isFinite(cached.createdAt)) return null;

      return cached;
    } catch (error) {
      return null;
    }
  }

  function writeNewsCache(url, text) {
    try {
      localStorage.setItem(getNewsCacheKey(url), JSON.stringify({
        createdAt: Date.now(),
        text
      }));
    } catch (error) {
      // The page can still work without localStorage.
    }
  }

  function getNewsCacheKey(url) {
    return `${NEWS_CACHE_PREFIX}${url}`;
  }

  function csvToNewsPosts(text) {
    const rows = parseCsvRows(text);
    if (rows.length < 2) return [];

    const headers = rows[0].map(normalizeHeader);

    return rows.slice(1).map((row, index) => {
      const title = getCsvField(row, headers, "title", "заголовок", "название");
      const date = getCsvField(row, headers, "date", "published_at", "published", "дата");
      const content = normalizeNewsText(getCsvField(row, headers, "content", "body", "text", "контент", "текст", "содержание"));
      const id = getCsvField(row, headers, "id", "slug", "код") || createNewsId(title, date, index);

      return {
        id,
        published: parsePublished(getCsvField(row, headers, "published", "active", "visible", "опубликовано")),
        title,
        date,
        image: normalizeNewsImageUrl(getCsvField(row, headers, "image", "image_url", "photo", "картинка", "изображение")),
        imageAlt: getCsvField(row, headers, "image_alt", "imagealt", "alt", "описание изображения"),
        content
      };
    });
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let value = "";
    let isQuoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (isQuoted && nextChar === '"') {
          value += '"';
          i += 1;
        } else {
          isQuoted = !isQuoted;
        }
        continue;
      }

      if (char === "," && !isQuoted) {
        row.push(value);
        value = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !isQuoted) {
        if (char === "\r" && nextChar === "\n") i += 1;
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
        continue;
      }

      value += char;
    }

    row.push(value);
    rows.push(row);

    return rows.filter((items) => items.some((item) => String(item || "").trim()));
  }

  function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  }

  function getCsvField(row, headers, ...names) {
    for (const name of names.map(normalizeHeader)) {
      const index = headers.indexOf(name);
      if (index !== -1) return String(row[index] || "").trim();
    }

    return "";
  }

  function normalizeNewsText(value) {
    return String(value || "").replaceAll("\\n", "\n").trim();
  }

  function normalizeNewsImageUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";

    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (driveMatch) {
      return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveMatch[1])}&sz=w1200`;
    }

    return url;
  }

  function parsePublished(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return true;
    return !["0", "false", "no", "нет", "не опубликовано", "draft", "черновик"].includes(normalized);
  }

  function createNewsId(title, date, index) {
    const readablePart = [date, title]
      .filter(Boolean)
      .join("-")
      .toLowerCase()
      .replaceAll("ё", "е")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");

    return readablePart || `news-${index + 1}`;
  }

  function isPublishedPost(post) {
    return post && post.published !== false && post.id && post.title;
  }

  function sortPostsByDate(a, b) {
    return dateValue(b.date) - dateValue(a.date);
  }

  function dateValue(value) {
    const date = parseNewsDate(value);
    return date ? date.getTime() : 0;
  }

  function parseNewsDate(value) {
    const text = String(value || "").trim();
    if (!text) return null;

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    }

    const displayMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (displayMatch) {
      return new Date(Number(displayMatch[3]), Number(displayMatch[2]) - 1, Number(displayMatch[1]));
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function renderNewsLoading(container) {
    container.innerHTML = `<div class="empty-state news-empty">Новости загружаются.</div>`;
  }

  function renderNewsError(container) {
    container.innerHTML = `<div class="empty-state news-empty">${NEWS_LOAD_ERROR}</div>`;
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
          <p>${escapeHtml(getExcerpt(post))}</p>
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

    return normalizeNewsText(post.content)
      .split(/\r?\n\s*\r?\n|\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function getExcerpt(post) {
    const text = getContent(post).join(" ").replace(/\s+/g, " ").trim();
    if (!text || text.length <= NEWS_EXCERPT_LIMIT) return text;

    const clipped = text.slice(0, NEWS_EXCERPT_LIMIT + 1);
    const lastSpace = clipped.lastIndexOf(" ");
    const end = lastSpace > 80 ? lastSpace : NEWS_EXCERPT_LIMIT;

    return `${text.slice(0, end).trim()}...`;
  }

  function formatNewsDate(value) {
    const date = parseNewsDate(value);

    if (!date) {
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
