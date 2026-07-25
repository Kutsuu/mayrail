(() => {
  const PROJECT_CACHE_TTL_MS = 2 * 60 * 1000;
  const PROJECT_CACHE_PREFIX = "mayrail-project-data-v1:";
  const PROJECT_LOAD_ERROR = "Проекты сейчас недоступны. Пожалуйста, попробуйте позже.";
  const PROJECT_IMAGE_PLACEHOLDER = "assets/img/placeholder.png";
  const PROJECT_SECTIONS = [
    { key: "archive", label: "Выполненные", empty: "Выполненные проекты пока не опубликованы." },
    { key: "active", label: "Текущие", empty: "Текущие проекты пока не опубликованы." },
    { key: "planned", label: "Запланированные", empty: "Запланированные проекты пока не опубликованы." }
  ];

  initProjects();

  async function initProjects() {
    const workspace = document.querySelector("[data-project-workspace]");
    if (!workspace) return;

    renderProjectLoading(workspace);

    try {
      const projects = await loadProjects();
      renderProjects(workspace, projects);
    } catch (error) {
      console.error(error);
      renderProjectError(workspace);
    }
  }

  async function loadProjects() {
    const source = window.MAYRAIL_PROJECTS || {};

    if (source.kind) {
      const client = window.MAYRAIL_FIREBASE_CONTENT;
      if (!client) throw new Error("Firebase content client is unavailable");
      const items = await client.load(source.kind);
      return items.map((item) => {
        const imageSources = getProjectImageSources(item.image);
        return {
          id: item.id,
          title: String(item.title || "").trim(),
          description: normalizeProjectText(item.body),
          status: String(item.status || "active"),
          image: imageSources[0],
          imageFallbacks: imageSources.slice(1),
          imageAlt: String(item.imageAlt || "").trim(),
          published: item.published === true,
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : 0
        };
      }).filter(isPublishedProject).sort((left, right) =>
        left.order - right.order ||
        left.title.localeCompare(right.title, "ru")
      );
    }

    if (source.source) {
      const text = await fetchTextWithCache(source.source);
      return csvToProjects(text).filter(isPublishedProject);
    }

    if (Array.isArray(source.projects)) {
      return source.projects.filter(isPublishedProject);
    }

    return [];
  }

  async function fetchTextWithCache(url) {
    const cached = readProjectCache(url);
    const isFresh = cached && Date.now() - cached.createdAt < PROJECT_CACHE_TTL_MS;

    if (isFresh) {
      return cached.text;
    }

    try {
      const response = await fetch(url, { cache: "no-store" });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Project request failed: ${response.status}`);
      }
      writeProjectCache(url, text);
      return text;
    } catch (error) {
      if (cached?.text) return cached.text;
      throw error;
    }
  }

  function readProjectCache(url) {
    try {
      const rawValue = localStorage.getItem(getProjectCacheKey(url));
      if (!rawValue) return null;

      const cached = JSON.parse(rawValue);
      if (typeof cached.text !== "string" || !Number.isFinite(cached.createdAt)) return null;

      return cached;
    } catch (error) {
      return null;
    }
  }

  function writeProjectCache(url, text) {
    try {
      localStorage.setItem(getProjectCacheKey(url), JSON.stringify({
        createdAt: Date.now(),
        text
      }));
    } catch (error) {
      // The page can still work without localStorage.
    }
  }

  function getProjectCacheKey(url) {
    return `${PROJECT_CACHE_PREFIX}${url}`;
  }

  function csvToProjects(text) {
    const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim()));
    if (rows.length < 2) return [];

    const headers = rows[0].map(normalizeHeader);

    return rows.slice(1).map((row, index) => {
      const title = getCsvField(row, headers, "title", "name", "project", "название", "название проекта", "проект") || String(row[0] || "").trim();
      const description = normalizeProjectText(getCsvField(row, headers, "description", "content", "body", "text", "описание", "текст", "содержание", "информация"));
      const imageSources = getProjectImageSources(getCsvField(row, headers, "image", "image_url", "photo", "photo_url", "picture", "картинка", "изображение", "фото", "фотография", "ссылка фото", "ссылка на фото", "ссылка изображения"));

      return {
        id: getCsvField(row, headers, "id", "slug", "код") || createProjectId(title, index),
        title,
        description,
        status: normalizeProjectStatus(getCsvField(row, headers, "status", "state", "section", "type", "статус", "состояние", "раздел", "лист", "тип", "этап")),
        image: imageSources[0],
        imageFallbacks: imageSources.slice(1),
        imageAlt: getCsvField(row, headers, "image_alt", "imagealt", "alt", "описание изображения"),
        published: parsePublished(getCsvField(row, headers, "published", "active", "visible", "опубликовано", "опубликован", "показывать", "активно")),
        order: index
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

      if (char === '"' && isQuoted && nextChar === '"') {
        value += '"';
        i += 1;
        continue;
      }

      if (char === '"') {
        isQuoted = !isQuoted;
        continue;
      }

      if (char === "," && !isQuoted) {
        row.push(value.trim());
        value = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !isQuoted) {
        if (char === "\r" && nextChar === "\n") i += 1;
        row.push(value.trim());
        rows.push(row);
        row = [];
        value = "";
        continue;
      }

      value += char;
    }

    row.push(value.trim());
    rows.push(row);

    return rows;
  }

  function normalizeHeader(value) {
    return String(value || "")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replaceAll("ё", "е")
      .replace(/[^0-9a-zа-я]+/gi, "_")
      .replace(/^_+|_+$/g, "");
  }

  function getCsvField(row, headers, ...aliases) {
    for (const alias of aliases.map(normalizeHeader)) {
      const index = headers.indexOf(alias);
      if (index !== -1) return String(row[index] || "").trim();
    }

    return "";
  }

  function normalizeProjectText(value) {
    return String(value || "").replaceAll("\\n", "\n").trim();
  }

  function normalizeProjectStatus(value) {
    const status = normalizeHeader(value);

    if (!status) return "active";
    if (/(выполн|заверш|готов|сделан|архив|done|complete|archive)/.test(status)) return "archive";
    if (/(план|будущ|заплан|planned|plan)/.test(status)) return "planned";
    if (/(работ|текущ|процесс|active|current|progress|work)/.test(status)) return "active";

    return "active";
  }

  function getProjectImageSources(value) {
    const src = String(value || "").trim();
    if (!src) return [PROJECT_IMAGE_PLACEHOLDER];

    const driveImage = getGoogleDriveImageSource(src);
    if (driveImage) return [driveImage, PROJECT_IMAGE_PLACEHOLDER];

    if (/^(https?:|data:|\/|assets\/)/i.test(src)) return [src, PROJECT_IMAGE_PLACEHOLDER];

    return [
      `assets/img/projects/${src}`,
      `assets/img/${src}`,
      PROJECT_IMAGE_PLACEHOLDER
    ];
  }

  function getGoogleDriveImageSource(src) {
    const fileMatch = src.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    const idMatch = src.match(/[?&]id=([^&]+)/i);
    const id = fileMatch?.[1] || idMatch?.[1];

    return id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200` : "";
  }

  function parsePublished(value) {
    const normalized = normalizeHeader(value);
    if (!normalized) return true;

    return !["0", "false", "no", "n", "нет", "не_опубликовано", "скрыто", "скрыть", "off"].includes(normalized);
  }

  function isPublishedProject(project) {
    return project && project.published !== false && project.title;
  }

  function createProjectId(title, index) {
    const readablePart = normalizeHeader(title)
      .replace(/_/g, "-")
      .replace(/^-+|-+$/g, "");

    return readablePart || `project-${index + 1}`;
  }

  function renderProjectLoading(workspace) {
    const panels = workspace.querySelector("[data-project-panels]");

    if (panels) {
      panels.innerHTML = `<div class="empty-state project-empty">Проекты загружаются.</div>`;
    }
  }

  function renderProjectError(workspace) {
    const panels = workspace.querySelector("[data-project-panels]");

    if (panels) {
      panels.innerHTML = `<div class="empty-state project-empty">${PROJECT_LOAD_ERROR}</div>`;
    }
  }

  function renderProjects(workspace, projects) {
    const panels = workspace.querySelector("[data-project-panels]");
    if (!panels) return;

    const groupedProjects = groupProjects(projects);
    panels.innerHTML = PROJECT_SECTIONS.map((section) => renderProjectSection(section, groupedProjects.get(section.key) || [])).join("");

    setupProjectImageFallback(panels);
  }

  function groupProjects(projects) {
    return projects.reduce((groups, project) => {
      const key = PROJECT_SECTIONS.some((section) => section.key === project.status) ? project.status : "active";
      const group = groups.get(key) || [];
      group.push(project);
      groups.set(key, group);
      return groups;
    }, new Map());
  }

  function renderProjectSection(section, projects) {
    return `
      <section class="project-category" data-project-section="${section.key}">
        <h3>${escapeHtml(section.label)}</h3>
        <div class="project-category-list">
          ${projects.length ? projects.map(renderProjectRow).join("") : `<div class="empty-state project-empty">${escapeHtml(section.empty)}</div>`}
        </div>
      </section>
    `;
  }

  function renderProjectRow(project) {
    return `
      <article class="project-row">
        ${renderProjectImage(project)}
        <div class="project-card-body">
          <h3>${escapeHtml(project.title)}</h3>
          ${getProjectParagraphs(project).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        </div>
      </article>
    `;
  }

  function renderProjectImage(project) {
    const hasImage = Boolean(project.image && project.image !== PROJECT_IMAGE_PLACEHOLDER);
    const classes = `project-row-image${hasImage ? "" : " is-placeholder"}`;
    const fallbackCandidates = project.imageFallbacks?.length
      ? ` data-fallback-candidates="${escapeHtml(project.imageFallbacks.join("|"))}"`
      : "";

    return `<img class="${classes}" src="${escapeHtml(project.image || PROJECT_IMAGE_PLACEHOLDER)}" alt="${escapeHtml(project.imageAlt || "")}" loading="lazy" data-project-image${fallbackCandidates}>`;
  }

  function getProjectParagraphs(project) {
    return normalizeProjectText(project.description)
      .split(/\r?\n\s*\r?\n|\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function setupProjectImageFallback(container) {
    container.querySelectorAll("img[data-project-image]").forEach((image) => {
      const applyNextFallback = () => {
        const candidates = String(image.dataset.fallbackCandidates || "")
          .split("|")
          .map(value => value.trim())
          .filter(Boolean);
        const next = candidates.shift();
        image.dataset.fallbackCandidates = candidates.join("|");
        image.classList.add("is-placeholder");
        if (next && image.getAttribute("src") !== next) image.src = next;
      };
      image.addEventListener("error", applyNextFallback);
      if (image.complete && image.naturalWidth === 0) applyNextFallback();
    });
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
