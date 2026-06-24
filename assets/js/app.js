const routeForm = document.querySelector("#route-search");
const fromInput = document.querySelector("#from");
const toInput = document.querySelector("#to");
const fromOptions = document.querySelector("#from-options");
const toOptions = document.querySelector("#to-options");
const dateInput = document.querySelector("#date");
const timeInput = document.querySelector("#time");
const timeLabel = document.querySelector("#time-label");
const timeModeInputs = [...document.querySelectorAll('input[name="timeMode"]')];
const results = document.querySelector("#results");
const resultsActions = document.querySelector("#results-actions");
const loadMoreButton = document.querySelector("#load-more-routes");
const cardTemplate = document.querySelector("#route-card-template");
const swapButton = document.querySelector("#swap-stations");
const scheduleDays = document.querySelector("#schedule-days");
const scheduleTable = document.querySelector("#schedule-table");
const scheduleTableShell = document.querySelector(".passenger-table-shell");
const scheduleScrollActions = document.querySelector(".schedule-scroll-actions");
const scheduleScrollPrev = document.querySelector("#schedule-scroll-prev");
const scheduleScrollNext = document.querySelector("#schedule-scroll-next");
const scheduleEmpty = document.querySelector("#schedule-empty");
const stationMap = document.querySelector("#station-map");
const isRedirectSearch = routeForm.dataset.searchMode === "redirect";

const INITIAL_RESULTS_LIMIT = 3;
const RESULTS_INCREMENT = 2;
const MAX_RESULTS_LIMIT = 5;
const MIN_TRANSFER_MINUTES = 0;
const DEFAULT_SCHEDULE_LOOKAHEAD_DAYS = 14;
const MAX_PUBLISHED_SCHEDULE_DAYS = 5;
const ROUTE_CACHE_TTL_MS = 2 * 60 * 1000;
const ROUTE_CACHE_PREFIX = "mayrail-route-data-v1:";
const ROUTE_LOAD_ERROR_MESSAGE = "Расписание сейчас недоступно. Пожалуйста, свяжитесь с оператором.";

let routeData = { routes: [] };
let stations = [];
let currentMatches = [];
let visibleResultsLimit = INITIAL_RESULTS_LIMIT;
let selectedScheduleDateValue = "";
let isScheduleDragging = false;
let scheduleDragStartX = 0;
let scheduleDragStartScroll = 0;

const stationPickers = new Map([
  [fromInput, { list: fromOptions, activeIndex: 0, forceAll: false }],
  [toInput, { list: toOptions, activeIndex: 0, forceAll: false }]
]);

setCurrentDateTime();

init();

async function init() {
  setupStationPicker(fromInput);
  setupStationPicker(toInput);

  try {
    routeData = await loadRouteData();
    hydrateStations(routeData.routes);
    renderPassengerTools();
    if (applySearchParams() && !isRedirectSearch) {
      runSearch();
    }
  } catch (error) {
    renderEmpty(ROUTE_LOAD_ERROR_MESSAGE);
    console.error(error);
  }
}

async function loadRouteData() {
  const source = routeForm.dataset.routesSource || "data/routes/";
  const sourceUrl = new URL(source, window.location.href);
  const sourcePath = sourceUrl.pathname.toLowerCase();

  if (source.endsWith("/") || !sourcePath.split("/").pop().includes(".")) {
    return loadRouteManifest(new URL("manifest.json", sourceUrl.href.endsWith("/") ? sourceUrl.href : `${sourceUrl.href}/`));
  }

  if (sourcePath.endsWith(".json")) {
    return loadRouteManifest(sourceUrl);
  }

  return loadRouteCsv(sourceUrl);
}

async function loadRouteCsv(sourceUrl) {
  const text = await fetchTextWithCache(sourceUrl.href);
  return csvToRouteData(text);
}

async function loadRouteManifest(manifestUrl) {
  const text = await fetchTextWithCache(manifestUrl.href);
  const manifest = JSON.parse(text);
  const files = normalizeRouteManifest(manifest);

  if (!files.length) {
    throw new Error(`Route manifest is empty: ${manifestUrl.href}`);
  }

  const routeDataSets = await Promise.all(files.map((file, index) => {
    const fileUrl = new URL(file, manifestUrl);
    return loadRouteCsv(fileUrl).then((data) => namespaceRouteData(data, index));
  }));

  return mergeRouteData(routeDataSets);
}

async function fetchTextWithCache(url) {
  const cached = readRouteCache(url);
  const isFresh = cached && Date.now() - cached.createdAt < ROUTE_CACHE_TTL_MS;

  if (isFresh) {
    return cached.text;
  }

  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Data request failed: ${response.status} (${url})`);
  }

  writeRouteCache(url, text);
  return text;
}

function readRouteCache(url) {
  try {
    const rawValue = localStorage.getItem(getRouteCacheKey(url));
    if (!rawValue) return null;

    const cached = JSON.parse(rawValue);
    if (typeof cached.text !== "string" || !Number.isFinite(cached.createdAt)) return null;

    return cached;
  } catch (error) {
    return null;
  }
}

function writeRouteCache(url, text) {
  try {
    localStorage.setItem(getRouteCacheKey(url), JSON.stringify({
      createdAt: Date.now(),
      text
    }));
  } catch (error) {
    // localStorage can be unavailable or full; the site can still load from the network.
  }
}

function getRouteCacheKey(url) {
  return `${ROUTE_CACHE_PREFIX}${url}`;
}

function normalizeRouteManifest(manifest) {
  const entries = Array.isArray(manifest)
    ? manifest
    : Array.isArray(manifest.files)
      ? manifest.files
      : Array.isArray(manifest.schedules)
        ? manifest.schedules
        : [];

  return entries
    .map((entry) => typeof entry === "string" ? entry : entry?.path || entry?.file || entry?.href)
    .filter(Boolean);
}

function namespaceRouteData(data, sourceIndex) {
  const namespace = `schedule-${sourceIndex + 1}`;

  return {
    routes: (data.routes || []).map((route) => ({
      ...route,
      id: `${namespace}-${route.id || route.line || route.direction || "route"}`
    }))
  };
}

function mergeRouteData(routeDataSets) {
  return {
    routes: routeDataSets.flatMap((data) => data.routes || [])
  };
}

function csvToRouteData(csv) {
  const rows = parseCsv(csv);

  if (isWideTrainSchedule(rows)) {
    return wideTrainScheduleToRouteData(rows);
  }

  if (isMatrixSchedule(rows)) {
    return matrixScheduleToRouteData(rows);
  }

  return flatScheduleToRouteData(rows.filter((row) => row.some((cell) => cell.trim())));
}

function isMatrixSchedule(rows) {
  return rows.some(isStopHeaderRow);
}

function isWideTrainSchedule(rows) {
  return rows.some(isWideTrainHeaderRow);
}

function isWideTrainHeaderRow(row) {
  const header = row.map(normalizeStation);
  return (header[0] === "предупреждение" || header[0] === "примечание")
    && header[1] === "номер поезда"
    && header[2] === "маршрут";
}

function wideTrainScheduleToRouteData(rows) {
  const headerIndexes = rows.reduce((indexes, row, index) => {
    if (isWideTrainHeaderRow(row)) indexes.push(index);
    return indexes;
  }, []);

  const routes = headerIndexes.flatMap((headerIndex, blockIndex) => {
    const nextHeaderIndex = headerIndexes[blockIndex + 1] ?? rows.length;
    const meta = getWideScheduleMeta(rows, headerIndex);
    const stationColumns = getWideStationColumns(rows[headerIndex] || [], rows[headerIndex + 1] || []);

    return rows
      .slice(headerIndex + 2, nextHeaderIndex)
      .map((row, rowIndex) => buildWideTrainRoute(row, stationColumns, meta, blockIndex, rowIndex))
      .filter(Boolean);
  });

  return { routes };
}

function getWideScheduleMeta(rows, headerIndex) {
  return rows.slice(0, headerIndex).reduce((meta, row) => {
    const label = normalizeStation(row[0]);
    const value = row.slice(1).find((cell) => cell.trim())?.trim() || "";

    if (label === "от") {
      meta.periodStart = parseLocalDateTime(value);
      return meta;
    }

    if (label === "до") {
      meta.periodEnd = parseLocalDateTime(value);
      return meta;
    }

    if (label === "период") {
      const [periodStart, periodEnd] = parsePeriodCells(row.slice(1));
      meta.periodStart = periodStart || meta.periodStart;
      meta.periodEnd = periodEnd || meta.periodEnd;
    }

    return meta;
  }, {
    periodStart: null,
    periodEnd: null
  });
}

function getWideStationColumns(stationRow, labelRow) {
  const stationIndexes = stationRow
    .map((value, index) => ({ station: value.trim(), index }))
    .filter((item) => item.index > 2 && item.station);

  return stationIndexes.map((item, index) => {
    const nextIndex = stationIndexes[index + 1]?.index ?? stationRow.length;
    const columns = Array.from({ length: nextIndex - item.index }, (_, offset) => item.index + offset);
    const arrivalColumn = columns.find((column) => labelRow[column]?.trim().toLowerCase().startsWith("приб"));
    const departureColumn = columns.find((column) => labelRow[column]?.trim().toLowerCase().startsWith("отпр"));

    return {
      station: item.station,
      arrivalColumn: Number.isInteger(arrivalColumn) ? arrivalColumn : columns[0],
      departureColumn: Number.isInteger(departureColumn) ? departureColumn : columns[1]
    };
  }).filter((item) => item.station && Number.isInteger(item.arrivalColumn));
}

function buildWideTrainRoute(row, stationColumns, meta, blockIndex, rowIndex) {
  const warning = row[0]?.trim() || "";
  const line = row[1]?.trim() || "";
  const direction = row[2]?.trim() || "";

  if (!line || !direction || !stationColumns.length) return null;

  const routeMap = getWideRouteMap(direction, stationColumns);
  const { trip, stops } = buildWideTrip(row, routeMap.columns, routeMap.stations, {
    warning,
    periodStart: meta.periodStart || null,
    periodEnd: meta.periodEnd || null
  });

  if (!trip.depart || !trip.arrive || stops.length < 2) return null;

  return {
    id: `wide-${blockIndex + 1}-${rowIndex + 1}-${line}`,
    line,
    direction,
    mode: "train",
    service: "Пассажирский поезд",
    from: stops[0],
    to: stops[stops.length - 1],
    stops,
    trips: [trip]
  };
}

function getWideRouteMap(direction, stationColumns) {
  const stations = stationColumns.map((item) => item.station);
  const routeParts = direction
    .split(/\s+[—–-]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (routeParts.length < 2) {
    return { columns: stationColumns, stations };
  }

  const startIndex = stations.findIndex((station) => normalizeStation(station) === normalizeStation(routeParts[0]));
  const endIndex = stations.findIndex((station) => normalizeStation(station) === normalizeStation(routeParts.at(-1)));

  if (startIndex === -1 || endIndex === -1 || startIndex === endIndex) {
    return { columns: stationColumns, stations };
  }

  const firstIndex = Math.min(startIndex, endIndex);
  const lastIndex = Math.max(startIndex, endIndex);
  const columns = stationColumns.slice(firstIndex, lastIndex + 1);
  const routeStations = columns.map((item) => item.station);

  return {
    columns,
    stations: startIndex <= endIndex ? routeStations : routeStations.reverse()
  };
}

function buildWideTrip(row, stationColumns, stations, meta = {}) {
  const stops = [];
  const stopTimes = {};
  const arrivalTimes = {};
  const departureTimes = {};
  const departureCandidates = [];
  const arrivalCandidates = [];
  let previousTime = "";

  stationColumns.forEach((columns, index) => {
    const station = stations[index];
    if (!station) return;

    const arrival = alignTimeToPrevious(normalizeTimeCell(row[columns.arrivalColumn]), previousTime);
    const departure = alignTimeToPrevious(normalizeTimeCell(row[columns.departureColumn]), arrival || previousTime);
    const publicTime = departure || arrival;

    if (arrival) {
      arrivalTimes[station] = arrival;
      arrivalCandidates.push(arrival);
    }

    if (departure) {
      departureTimes[station] = departure;
      departureCandidates.push(departure);
    }

    if (publicTime) {
      stops.push(station);
      stopTimes[station] = publicTime;
      previousTime = publicTime;
    }
  });

  return {
    stops,
    trip: {
      depart: departureCandidates[0] || Object.values(stopTimes)[0] || "",
      arrive: arrivalCandidates[arrivalCandidates.length - 1] || Object.values(stopTimes).at(-1) || "",
      platform: "—",
      platforms: {},
      days: "daily",
      status: "По расписанию",
      price: "",
      note: "",
      warning: meta.warning || "",
      periodStart: meta.periodStart || null,
      periodEnd: meta.periodEnd || null,
      stopTimes,
      arrivalTimes,
      departureTimes
    }
  };
}

function matrixScheduleToRouteData(rows) {
  const headerIndexes = rows.reduce((indexes, row, index) => {
    if (isStopHeaderRow(row)) indexes.push(index);
    return indexes;
  }, []);

  const routes = headerIndexes.flatMap((headerIndex, blockIndex) => {
    const nextHeaderIndex = headerIndexes[blockIndex + 1] ?? rows.length;
    const meta = getBlockMeta(rows, headerIndex);
    const trainNumbers = rows[headerIndex - 1] || [];
    const labels = rows[headerIndex] || [];
    const trainGroups = getTrainGroups(trainNumbers, labels);
    const stopRows = rows
      .slice(headerIndex + 1, nextHeaderIndex)
      .filter((row) => isMatrixStopRow(row, trainGroups));
    const stops = stopRows.map((row) => row[0].trim());

    return trainGroups.map((group) => {
      const line = group.line;
      const trip = buildMatrixTrip(stopRows, group, meta);

      if (!line || !trip.depart || !trip.arrive || stops.length < 2) return null;

      return {
        id: `train-${blockIndex + 1}-${line}`,
        line,
        direction: meta.title,
        mode: "train",
        service: "Пассажирский поезд",
        from: stops[0],
        to: stops[stops.length - 1],
        stops,
        trips: [trip]
      };
    }).filter(Boolean);
  });

  return { routes };
}

function isStopHeaderRow(row) {
  const header = row.map((cell) => cell.trim().toLowerCase());
  return header[0] === "остановка" && header.some((cell) => cell.startsWith("приб")) && header.some((cell) => cell.startsWith("отпр"));
}

function getFirstFilledCell(row = []) {
  return row.find((cell) => cell.trim())?.trim() || "";
}

function getBlockMeta(rows, headerIndex) {
  const metaRows = [];

  for (let index = headerIndex - 2; index >= 0; index -= 1) {
    const row = rows[index] || [];
    if (!row.some((cell) => cell.trim())) break;
    if (isStopHeaderRow(row)) break;

    metaRows.unshift(row);
  }

  return metaRows.reduce((meta, row) => {
    const label = normalizeStation(row[0]);
    const value = row.slice(1).find((cell) => cell.trim())?.trim() || "";

    if (label === "маршрут") {
      meta.title = value;
      return meta;
    }

    if (label === "предупреждение") {
      meta.warning = value;
      return meta;
    }

    if (label === "период") {
      const [periodStart, periodEnd] = parsePeriodCells(row.slice(1));
      meta.periodStart = periodStart || null;
      meta.periodEnd = periodEnd || null;
      return meta;
    }

    if (!meta.title) {
      meta.title = getFirstFilledCell(row);
    }

    return meta;
  }, {
    title: "",
    warning: "",
    periodStart: null,
    periodEnd: null
  });
}

function isMatrixStopRow(row, trainGroups) {
  const station = row[0]?.trim();
  if (!station || isScheduleMetaRow(row)) return false;

  return trainGroups.some((group) => {
    const arrival = normalizeTimeCell(row[group.arrivalColumn]);
    const departure = normalizeTimeCell(row[group.departureColumn]);
    const platform = row[group.platformColumn]?.trim() || "";

    return arrival || departure || platform;
  });
}

function isScheduleMetaRow(row) {
  return ["маршрут", "период", "предупреждение"].includes(normalizeStation(row[0]));
}

function getTrainGroups(trainNumbers, labels) {
  const starts = trainNumbers
    .map((value, index) => ({ value: value.trim(), index }))
    .filter((item) => item.index > 0 && item.value);

  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? labels.length;
    const columns = Array.from({ length: end - start.index }, (_, offset) => start.index + offset);
    const arrivalColumn = columns.find((column) => labels[column]?.trim().toLowerCase().startsWith("приб"));
    const platformColumn = columns.find((column) => labels[column]?.trim().toLowerCase().startsWith("путь"));
    const departureColumn = columns.find((column) => labels[column]?.trim().toLowerCase().startsWith("отпр"));

    return {
      line: start.value,
      arrivalColumn,
      platformColumn,
      departureColumn
    };
  }).filter((group) => Number.isInteger(group.arrivalColumn) || Number.isInteger(group.departureColumn));
}

function buildMatrixTrip(stopRows, group, meta = {}) {
  const stopTimes = {};
  const arrivalTimes = {};
  const departureTimes = {};
  const platforms = {};
  const departureCandidates = [];
  const arrivalCandidates = [];
  let previousTime = "";

  stopRows.forEach((row) => {
    const station = row[0].trim();
    const arrival = alignTimeToPrevious(normalizeTimeCell(row[group.arrivalColumn]), previousTime);
    const departure = alignTimeToPrevious(normalizeTimeCell(row[group.departureColumn]), arrival || previousTime);
    const platform = row[group.platformColumn]?.trim() || "";
    const publicTime = departure || arrival;

    if (arrival) {
      arrivalTimes[station] = arrival;
      arrivalCandidates.push(arrival);
    }

    if (departure) {
      departureTimes[station] = departure;
      departureCandidates.push(departure);
    }

    if (publicTime) {
      stopTimes[station] = publicTime;
      previousTime = publicTime;
    }

    if (platform) {
      platforms[station] = platform;
    }
  });

  return {
    depart: departureCandidates[0] || Object.values(stopTimes)[0] || "",
    arrive: arrivalCandidates[arrivalCandidates.length - 1] || Object.values(stopTimes).at(-1) || "",
    platform: Object.values(platforms)[0] || "—",
    platforms,
    days: "daily",
    status: "По расписанию",
    price: "",
    note: "",
    warning: meta.warning || "",
    periodStart: meta.periodStart || null,
    periodEnd: meta.periodEnd || null,
    stopTimes,
    arrivalTimes,
    departureTimes
  };
}

function flatScheduleToRouteData(rows) {
  const [headers, ...records] = rows;
  const keys = headers.map((header) => header.trim());
  const routesById = new Map();

  records
    .map((record) => Object.fromEntries(keys.map((key, index) => [key, record[index] || ""])))
    .filter((row) => row.route_id && row.depart)
    .forEach((row) => {
      const route = routesById.get(row.route_id) || {
        id: row.route_id,
        line: row.line || row.route_id,
        mode: row.mode || "train",
        service: row.service || "Пассажирский поезд",
        from: row.from,
        to: row.to,
        stops: splitList(row.stops),
        trips: []
      };

      route.trips.push({
        depart: row.depart,
        arrive: row.arrive,
        platform: row.platform || "—",
        days: row.days || "daily",
        status: row.status || "По расписанию",
        price: row.price,
        note: row.note,
        warning: row.warning || row.alert || "",
        periodStart: parseLocalDateTime(row.period_start || row.periodStart || ""),
        periodEnd: parseLocalDateTime(row.period_end || row.periodEnd || ""),
        stopTimes: parseStopTimes(row.stop_times),
        arrivalTimes: parseStopTimes(row.arrival_times),
        departureTimes: parseStopTimes(row.departure_times)
      });

      routesById.set(row.route_id, route);
    });

  return { routes: [...routesById.values()] };
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (value || row.length) {
        row.push(value);
        rows.push(row);
      }
      row = [];
      value = "";
      if (char === "\r" && next === "\n") index += 1;
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseStopTimes(value) {
  const times = {};
  splitList(value).forEach((pair) => {
    const [station, time] = pair.split("=").map((part) => part.trim());
    if (station && time) times[station] = normalizeTimeCell(time);
  });
  return times;
}

function parsePeriodCells(cells) {
  const dates = cells.flatMap((cell) => extractLocalDateTimes(cell));
  return [dates[0] || null, dates[1] || null];
}

function extractLocalDateTimes(value) {
  const text = String(value || "");
  const matches = [...text.matchAll(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/g)];
  return matches
    .map((match) => parseDateTimeParts(match[1], match[2], match[3], match[4], match[5]))
    .filter(Boolean);
}

function parseLocalDateTime(value) {
  return extractLocalDateTimes(value)[0] || null;
}

function parseDateTimeParts(day, month, year, hours = "0", minutes = "0") {
  const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  const date = new Date(fullYear, Number(month) - 1, Number(day), Number(hours), Number(minutes));

  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeTimeCell(value) {
  const text = String(value || "").trim();
  const match = text.match(/\b\d{1,2}:\d{2}\b/);
  return match ? match[0].padStart(5, "0") : "";
}

function alignTimeToPrevious(time, previousTime) {
  if (!time || !previousTime) return time;

  let minutes = timeToMinutes(time);
  const previousMinutes = timeToMinutes(previousTime);

  while (minutes < previousMinutes) {
    minutes += 1440;
  }

  return minutesToServiceClock(minutes);
}

function hydrateStations(routes) {
  stations = [...new Set(routes.flatMap((route) => route.stops))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));

  fromInput.value = "";
  toInput.value = "";
}

function setupStationPicker(input) {
  const picker = stationPickers.get(input);
  if (!picker) return;

  input.addEventListener("focus", () => {
    picker.forceAll = true;
    picker.activeIndex = 0;
    renderStationOptions(input);
  });
  input.addEventListener("input", () => {
    picker.forceAll = false;
    picker.activeIndex = 0;
    setStationValidity(input, true);
    renderStationOptions(input);
    clearResults();
  });
  input.addEventListener("blur", () => validateStationInput(input, false));
  input.addEventListener("keydown", (event) => handleStationKeydown(event, input));

  picker.list.addEventListener("mousedown", (event) => {
    const option = event.target.closest(".station-option");
    if (!option) return;

    event.preventDefault();
    selectStation(input, option.dataset.value);
  });
}

function renderStationOptions(input) {
  const picker = stationPickers.get(input);
  if (!picker || !stations.length) return;

  const query = picker.forceAll ? "" : normalizeStation(input.value);
  const filteredStations = stations.filter((station) => normalizeStation(station).includes(query));
  const visibleStations = filteredStations;

  picker.activeIndex = clamp(picker.activeIndex, 0, visibleStations.length - 1);
  picker.list.innerHTML = visibleStations.length
    ? visibleStations.map((station, index) => `
      <button class="station-option" type="button" role="option" data-value="${escapeHtml(station)}" aria-selected="${index === picker.activeIndex}">
        ${escapeHtml(station)}
      </button>
    `).join("")
    : '<div class="station-option station-option-empty">Станция не найдена</div>';

  picker.list.hidden = false;
  input.closest(".station-field")?.classList.add("is-open");
  input.setAttribute("aria-expanded", "true");
}

function handleStationKeydown(event, input) {
  const picker = stationPickers.get(input);
  if (!picker || picker.list.hidden) return;

  const options = [...picker.list.querySelectorAll(".station-option")];
  if (!options.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    picker.activeIndex = (picker.activeIndex + 1) % options.length;
    renderStationOptions(input);
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    picker.activeIndex = (picker.activeIndex - 1 + options.length) % options.length;
    renderStationOptions(input);
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const option = picker.list.querySelectorAll(".station-option")[picker.activeIndex];
    if (option) selectStation(input, option.dataset.value);
  }

  if (event.key === "Escape") {
    hideStationOptions(input);
  }
}

function selectStation(input, station) {
  const picker = stationPickers.get(input);
  if (picker) picker.forceAll = false;

  input.value = station;
  setStationValidity(input, true);
  hideStationOptions(input);
  clearResults();
}

function hideStationOptions(input) {
  const picker = stationPickers.get(input);
  if (!picker) return;

  picker.list.hidden = true;
  input.closest(".station-field")?.classList.remove("is-open");
  input.setAttribute("aria-expanded", "false");
}

function validateStationInput(input, shouldRenderError = true) {
  const isValid = !input.value.trim() || isKnownStation(input.value);
  setStationValidity(input, isValid);

  if (!isValid && shouldRenderError) {
    renderEmpty("Выберите станцию из списка.");
  }

  return isValid;
}

function validateSearchFields() {
  if (!stations.length) {
    renderEmpty(ROUTE_LOAD_ERROR_MESSAGE);
    return false;
  }

  const fromValid = validateStationInput(fromInput, false);
  const toValid = validateStationInput(toInput, false);

  if (!fromValid || !toValid) {
    renderEmpty("Выберите станцию из списка.");
    return false;
  }

  const from = normalizeStation(fromInput.value);
  const to = normalizeStation(toInput.value);

  if (!from || !to || from === to) {
    renderEmpty("Выберите разные станции отправления и прибытия.");
    return false;
  }

  return true;
}

function setStationValidity(input, isValid) {
  input.closest(".station-field")?.classList.toggle("is-invalid", !isValid);
  input.setAttribute("aria-invalid", String(!isValid));
}

document.addEventListener("mousedown", (event) => {
  stationPickers.forEach((picker, input) => {
    if (!input.closest(".station-field").contains(event.target)) {
      hideStationOptions(input);
    }
  });
});

function runSearch() {
  const from = normalizeStation(fromInput.value);
  const to = normalizeStation(toInput.value);
  const timeMode = getTimeMode();
  const time = timeInput.value || "00:00";

  if (!validateSearchFields()) return;

  currentMatches = findRouteMatches(from, to, time, timeMode, 0);

  if (!currentMatches.length) {
    const nextDayTime = timeMode === "arrive" ? "23:59" : "00:00";
    currentMatches = findRouteMatches(from, to, nextDayTime, timeMode, 1);
  }

  if (!currentMatches.length) {
    renderEmpty("На ближайшее время поездов по этому направлению не запланировано.");
    return;
  }

  visibleResultsLimit = INITIAL_RESULTS_LIMIT;
  renderRouteResults();
}

function renderRouteResults() {
  results.innerHTML = "";
  results.hidden = false;
  currentMatches.slice(0, visibleResultsLimit).forEach(renderRouteCard);
  updateLoadMoreButton();
}

function updateLoadMoreButton() {
  const hasMore = currentMatches.length > visibleResultsLimit;

  resultsActions.hidden = !hasMore;
  if (!hasMore) return;

  loadMoreButton.textContent = "Показать ещё";
}

function renderPassengerTools() {
  renderScheduleDays();
  renderScheduleTable();
  renderStationMap();
}

function renderScheduleTable() {
  if (!scheduleTable) return;

  const selectedDate = getSelectedScheduleDate();
  const schedule = buildScheduleMatrix(selectedDate);
  const hasRows = schedule.trains.length && schedule.stations.length;

  scheduleTable.innerHTML = hasRows ? renderScheduleMatrix(schedule) : "";

  if (scheduleTableShell) {
    scheduleTableShell.hidden = !hasRows;
  }

  if (scheduleScrollActions) {
    scheduleScrollActions.hidden = !hasRows;
  }

  if (scheduleEmpty) {
    scheduleEmpty.hidden = hasRows;
  }

  updateScheduleScrollButtons();
}

function renderScheduleDays() {
  if (!scheduleDays) return;

  const days = getPublishedScheduleDates();

  if (!days.length) {
    selectedScheduleDateValue = "";
    scheduleDays.innerHTML = '<div class="schedule-days-empty">Расписание не опубликовано</div>';
    return;
  }

  const hasSelectedDate = days.some((date) => formatInputDate(date) === selectedScheduleDateValue);
  if (!hasSelectedDate) {
    selectedScheduleDateValue = formatInputDate(days[0]);
  }

  scheduleDays.innerHTML = days.map((date) => {
    const value = formatInputDate(date);
    return `
      <button class="schedule-day ${value === selectedScheduleDateValue ? "is-active" : ""}" type="button" data-date="${value}">
        <span>${escapeHtml(formatWeekday(date))}</span>
        <strong>${escapeHtml(formatDayMonth(date))}</strong>
      </button>
    `;
  }).join("");
}

function getPublishedScheduleDates() {
  const trips = routeData.routes.flatMap((route) => route.trips || []);
  const today = startOfCalendarDay(new Date());
  const ranges = trips
    .map((trip) => getTripPublicationRange(trip, today))
    .filter(Boolean);

  if (!ranges.length) return [];

  const firstDate = new Date(Math.min(...ranges.map((range) => range.start.getTime())));
  const lastPublishedDate = new Date(Math.max(...ranges.map((range) => range.end.getTime())));
  const lastAllowedDate = addCalendarDays(firstDate, MAX_PUBLISHED_SCHEDULE_DAYS - 1);
  const lastDate = lastPublishedDate < lastAllowedDate ? lastPublishedDate : lastAllowedDate;
  const dates = [];

  for (let date = new Date(firstDate); date <= lastDate; date = addCalendarDays(date, 1)) {
    if (buildScheduleMatrix(date).trains.length) {
      dates.push(new Date(date));
    }
  }

  return dates;
}

function getTripPublicationRange(trip, today) {
  let start = trip.periodStart ? startOfCalendarDay(trip.periodStart) : new Date(today);
  if (start < today) start = new Date(today);

  const end = trip.periodEnd
    ? startOfCalendarDay(trip.periodEnd)
    : addCalendarDays(start, DEFAULT_SCHEDULE_LOOKAHEAD_DAYS - 1);

  if (end < start) return null;
  return { start, end };
}

function startOfCalendarDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addCalendarDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function getSelectedScheduleDate() {
  if (selectedScheduleDateValue) {
    return getDateFromInput({ value: selectedScheduleDateValue });
  }

  const publishedDates = getPublishedScheduleDates();
  if (publishedDates.length) {
    return new Date(publishedDates[0]);
  }

  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function buildScheduleMatrix(selectedDate) {
  const stations = getStationMapStations(routeData.routes);
  const trains = routeData.routes
    .flatMap((route) => route.trips
      .filter((trip) => tripRunsOnDate(trip, selectedDate))
      .map((trip) => ({
        route,
        trip,
        direction: getScheduleTrainDirection(route, stations)
      })))
    .sort((a, b) => sortScheduleTrains(a, b, stations));

  return { stations, trains };
}

function getScheduleTrainDirection(route, stations) {
  const normalizedStations = stations.map(normalizeStation);
  const startIndex = normalizedStations.indexOf(normalizeStation(route.stops[0]));
  const endIndex = normalizedStations.indexOf(normalizeStation(route.stops.at(-1)));

  if (startIndex === -1 || endIndex === -1) return "down";
  return startIndex <= endIndex ? "down" : "up";
}

function sortScheduleTrains(a, b, stations) {
  const timeOrder = timeToMinutes(a.trip.depart) - timeToMinutes(b.trip.depart);
  if (timeOrder) return timeOrder;

  const aStart = getStationIndex(stations, a.route.stops[0]);
  const bStart = getStationIndex(stations, b.route.stops[0]);
  return aStart - bStart;
}

function getStationIndex(stations, station) {
  return stations.findIndex((item) => normalizeStation(item) === normalizeStation(station));
}

function renderScheduleMatrix(schedule) {
  return `
    <table class="schedule-direction-table">
      <thead>
        <tr class="schedule-number-row schedule-number-row-top">
          <th class="schedule-station-cell"></th>
          ${schedule.trains.map((train) => renderScheduleTrainHead(train, "down")).join("")}
        </tr>
      </thead>
      <tbody>
        ${schedule.stations.map((station) => `
          <tr>
            <th class="schedule-station-cell ${isPrimaryStation(station) ? "is-primary" : ""}">${escapeHtml(station)}</th>
            ${schedule.trains.map((train) => renderScheduleTimeCell(train, station)).join("")}
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr class="schedule-number-row schedule-number-row-bottom">
          <th class="schedule-station-cell"></th>
          ${schedule.trains.map((train) => renderScheduleTrainHead(train, "up")).join("")}
        </tr>
      </tfoot>
    </table>
  `;
}

function renderScheduleTrainHead(train, rowDirection) {
  const directionClass = `is-${train.direction}`;

  if (train.direction === rowDirection) {
    return `<th class="schedule-train-head ${directionClass}"><span class="schedule-train-number">${escapeHtml(train.route.line)}</span></th>`;
  }

  return `<th class="schedule-train-head schedule-train-marker ${directionClass}" aria-hidden="true"></th>`;
}

function renderScheduleTimeCell(train, station) {
  const { route, trip, direction } = train;
  const directionClass = `is-${direction}`;
  const servesStation = route.stops.some((stop) => normalizeStation(stop) === normalizeStation(station));
  const time = servesStation ? getTripStationTime(trip, station) : "";

  if (!time) {
    return `<td class="schedule-time-cell schedule-empty-cell ${directionClass}"></td>`;
  }

  return `<td class="schedule-time-cell ${directionClass}"><time>${escapeHtml(formatClockForDisplay(time))}</time></td>`;
}

function getTripStationTime(trip, station) {
  return trip.departureTimes?.[station] || trip.arrivalTimes?.[station] || trip.stopTimes?.[station] || "";
}

function isPrimaryStation(station) {
  return normalizeStation(station) === "первомайск";
}

function renderStationMap() {
  if (!stationMap) return;

  const orderedStations = getStationMapStations(routeData.routes);
  stationMap.innerHTML = orderedStations.map((station) => `
    <li class="station-map-item">
      <span class="station-map-track" aria-hidden="true">
        <span class="station-map-dot"></span>
      </span>
      <span class="station-map-name">${escapeHtml(station)}</span>
    </li>
  `).join("");
}

function getStationMapStations(routes) {
  const primaryRoute = [...routes].sort((a, b) => b.stops.length - a.stops.length)[0];
  const orderedStations = primaryRoute ? [...primaryRoute.stops] : [];

  routes.forEach((route) => {
    route.stops.forEach((station) => {
      if (!orderedStations.some((item) => normalizeStation(item) === normalizeStation(station))) {
        orderedStations.push(station);
      }
    });
  });

  return orderedStations;
}

function tripRunsOnDate(trip, date) {
  if (!runsOnDateValue(trip.days, date)) return false;

  const departureDateTime = getDateTimeForDate(date, trip.depart);

  if (trip.periodStart && departureDateTime < trip.periodStart) return false;
  if (trip.periodEnd && departureDateTime > getPeriodEndBoundary(trip.periodEnd)) return false;

  return true;
}

function getPeriodEndBoundary(periodEnd) {
  const hasExplicitTime = periodEnd.getHours()
    || periodEnd.getMinutes()
    || periodEnd.getSeconds()
    || periodEnd.getMilliseconds();

  if (hasExplicitTime) return periodEnd;
  return new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 23, 59, 59, 999);
}

function runsOnDateValue(days, date) {
  const value = String(days || "daily").toLowerCase();
  if (value === "daily" || value === "ежедневно") return true;

  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;

  if (value === "weekdays" || value === "будни") return !isWeekend;
  if (value === "weekends" || value === "выходные") return isWeekend;
  return true;
}

function findRouteMatches(from, to, time, timeMode, dateOffset) {
  const directMatches = routeData.routes
    .flatMap((route) => buildRouteMatches(route, from, to, time, timeMode, dateOffset))
    .map((match) => ({ ...match, matchType: "direct", legs: [match] }));
  const transferMatches = buildTransferMatches(from, to, time, timeMode, dateOffset);
  const matches = [...directMatches, ...transferMatches];

  return matches
    .sort((a, b) => sortMatchesByTime(a, b, timeMode))
    .slice(0, MAX_RESULTS_LIMIT);
}

function buildSearchParams() {
  const params = new URLSearchParams();
  const values = {
    from: fromInput.value.trim(),
    to: toInput.value.trim(),
    date: getDisplayDateValue(dateInput),
    time: timeInput.value,
    timeMode: getTimeMode()
  };

  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  return params;
}

function applySearchParams() {
  const params = new URLSearchParams(window.location.search);
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const date = params.get("date") || "";
  const time = params.get("time") || "";
  const timeMode = params.get("timeMode") || "";

  if (from) fromInput.value = from;
  if (to) toInput.value = to;
  if (date) dateInput.value = getDisplayDateValue({ value: date }) || date;
  if (time) timeInput.value = time;

  const selectedTimeMode = timeModeInputs.find((input) => input.value === timeMode);
  if (selectedTimeMode) selectedTimeMode.checked = true;
  updateTimeModeLabel();

  return Boolean(from && to);
}

function redirectToSearchPage() {
  const target = routeForm.dataset.resultsPage || "search";
  const params = buildSearchParams();
  const destination = `${target}?${params.toString()}`;

  if (window.MayrailPageTransition?.navigate) {
    window.MayrailPageTransition.navigate(destination);
    return;
  }

  window.location.href = destination;
}

function updateSearchUrl() {
  if (!window.history?.replaceState) return;

  const url = new URL(window.location.href);
  url.search = buildSearchParams().toString();
  window.history.replaceState(null, "", url);
}

function buildRouteMatches(route, from, to, time, timeMode, dateOffset = 0) {
  return buildRouteLegs(route, from, to, dateOffset)
    .filter((match) => isMatchInTimeWindow(match, time, timeMode));
}

function buildRouteLegs(route, from, to, dateOffset = 0) {
  const normalizedStops = route.stops.map(normalizeStation);
  const fromIndex = normalizedStops.indexOf(from);
  const toIndex = normalizedStops.indexOf(to);

  if (fromIndex === -1 || toIndex === -1 || fromIndex >= toIndex) return [];

  return route.trips
    .filter((trip) => runsOnSelectedDay(trip.days, dateOffset))
    .map((trip) => {
      const fromStation = route.stops[fromIndex];
      const toStation = route.stops[toIndex];
      const depart = trip.departureTimes?.[fromStation] || trip.stopTimes?.[fromStation] || trip.depart;
      const arrive = trip.arrivalTimes?.[toStation] || trip.stopTimes?.[toStation] || trip.arrive;

      return {
        route,
        trip,
        platform: trip.platforms?.[fromStation] || trip.platform,
        depart,
        arrive,
        from: fromStation,
        to: toStation,
        dateOffset,
        stopsCount: toIndex - fromIndex,
        arrivalPlatform: trip.platforms?.[toStation] || "",
        intermediateStops: buildIntermediateStops(route, trip, fromIndex, toIndex)
      };
    })
    .filter(isMatchInSelectedPeriod)
    .map(markPastMatch);
}

function buildTransferMatches(from, to, time, timeMode, dateOffset = 0) {
  return stations
    .filter((station) => {
      const normalized = normalizeStation(station);
      return normalized !== from && normalized !== to;
    })
    .flatMap((transferStation) => {
      const transfer = normalizeStation(transferStation);
      const firstLegs = routeData.routes.flatMap((route) => buildRouteLegs(route, from, transfer, dateOffset));
      const secondLegs = routeData.routes.flatMap((route) => buildRouteLegs(route, transfer, to, dateOffset));

      return firstLegs
        .map((firstLeg) => {
          const secondLeg = secondLegs
            .filter((candidate) => isValidTransferPair(firstLeg, candidate))
            .sort((a, b) => timeToMinutes(a.depart) - timeToMinutes(b.depart))[0];

          return secondLeg ? buildTransferMatch(firstLeg, secondLeg, transferStation, dateOffset) : null;
        })
        .filter(Boolean);
    })
    .map(markPastMatch)
    .filter((match) => isMatchInTimeWindow(match, time, timeMode));
}

function isValidTransferPair(firstLeg, secondLeg) {
  if (firstLeg.route.id === secondLeg.route.id && firstLeg.trip === secondLeg.trip) {
    return false;
  }

  const firstArrival = timeToMinutes(firstLeg.arrive);
  const secondDeparture = timeToMinutes(secondLeg.depart);

  return secondDeparture >= firstArrival + MIN_TRANSFER_MINUTES;
}

function buildTransferMatch(firstLeg, secondLeg, transferStation, dateOffset) {
  const transferWait = getTransferWaitMinutes(firstLeg, secondLeg);
  const warnings = [firstLeg.trip.warning, secondLeg.trip.warning].filter(Boolean);

  return {
    matchType: "transfer",
    legs: [firstLeg, secondLeg],
    transferStation,
    transferWait,
    route: {
      line: [firstLeg.route.line, secondLeg.route.line].join(" / "),
      direction: `${firstLeg.from} - ${secondLeg.to}`,
      from: firstLeg.from,
      to: secondLeg.to
    },
    trip: {
      warning: [...new Set(warnings)].join(" ")
    },
    platform: firstLeg.platform,
    arrivalPlatform: secondLeg.arrivalPlatform,
    depart: firstLeg.depart,
    arrive: secondLeg.arrive,
    from: firstLeg.from,
    to: secondLeg.to,
    dateOffset,
    intermediateStops: [],
    isPast: false
  };
}

function getTransferWaitMinutes(firstLeg, secondLeg) {
  const firstArrival = timeToMinutes(firstLeg.arrive);
  const secondDeparture = timeToMinutes(secondLeg.depart);

  return secondDeparture - firstArrival;
}

function isMatchInSelectedPeriod(match) {
  const departureDateTime = getSelectedDateTime(match.depart, match.dateOffset);

  if (match.trip.periodStart && departureDateTime < match.trip.periodStart) return false;
  if (match.trip.periodEnd && departureDateTime > match.trip.periodEnd) return false;

  return true;
}

function markPastMatch(match) {
  return {
    ...match,
    isPast: getSelectedDateTime(match.depart, match.dateOffset) < new Date()
  };
}

function isMatchInTimeWindow(match, time, timeMode) {
  const targetMinutes = timeToMinutes(time);
  const departMinutes = timeToMinutes(match.depart);
  const arriveMinutes = timeToMinutes(match.arrive);

  if (timeMode === "arrive") {
    return arriveMinutes <= targetMinutes;
  }

  return departMinutes >= targetMinutes;
}

function sortMatchesByTime(a, b, timeMode) {
  if (timeMode === "arrive") {
    return timeToMinutes(b.arrive) - timeToMinutes(a.arrive);
  }

  return timeToMinutes(a.depart) - timeToMinutes(b.depart);
}

function buildIntermediateStops(route, trip, fromIndex, toIndex) {
  return route.stops.slice(fromIndex + 1, toIndex).map((station) => ({
    station,
    time: trip.stopTimes?.[station] || trip.arrivalTimes?.[station] || trip.departureTimes?.[station] || ""
  }));
}

function runsOnSelectedDay(days, dateOffset = 0) {
  const value = String(days || "daily").toLowerCase();
  if (value === "daily" || value === "ежедневно") return true;

  const selectedDate = getSelectedDate();
  selectedDate.setDate(selectedDate.getDate() + dateOffset);
  const day = selectedDate.getDay();
  const isWeekend = day === 0 || day === 6;

  if (value === "weekdays" || value === "будни") return !isWeekend;
  if (value === "weekends" || value === "выходные") return isWeekend;
  return true;
}

function renderRouteCard(match) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.classList.toggle("is-past", match.isPast);
  node.classList.toggle("has-transfer", match.matchType === "transfer");
  renderRouteHeading(node.querySelector(".route-heading"), match);
  node.querySelector('[data-field="depart"]').textContent = formatClockForDisplay(match.depart);
  node.querySelector('[data-field="arrive"]').textContent = formatClockForDisplay(match.arrive);
  renderTripDates(node, match);
  renderWarnings(node, match);

  const duration = durationBetween(match.depart, match.arrive);
  renderRouteLine(node.querySelector(".route-line"), duration, getTransferCount(match));
  setupRouteToggle(node, true);
  results.appendChild(node);
}

function renderRouteHeading(container, match) {
  const legs = getMatchLegs(match);

  container.innerHTML = legs.map((leg, index) => `
    <div class="route-leg-block">
      <div class="route-leg-summary">
        <span class="line-pill">${escapeHtml(leg.route.line)}</span>
        <span class="route-direction">${escapeHtml(getLegLabel(leg))}</span>
      </div>
      ${renderRouteLegDetails(leg)}
    </div>
    ${index < legs.length - 1 ? renderTransferWait(leg, legs[index + 1]) : ""}
  `).join("");
}

function getMatchLine(match) {
  return getMatchLegs(match).map((leg) => leg.route.line).join(" / ");
}

function getMatchDirection(match) {
  return getMatchLegs(match).map(getLegDirection).join(", ");
}

function getLegDirection(leg) {
  return `${leg.from} - ${leg.to}`;
}

function getLegLabel(leg) {
  return leg.route.direction || getLegDirection(leg);
}

function getMatchLegs(match) {
  return match.legs?.length ? match.legs : [match];
}

function getTransferCount(match) {
  return Math.max(0, getMatchLegs(match).length - 1);
}

function renderRouteLine(container, duration, transferCount = 0) {
  container.innerHTML = `
    <span class="route-duration">${escapeHtml(formatDuration(duration))}</span>
    <span class="route-rail"></span>
    <span class="route-kind">${escapeHtml(formatTransferInfo(transferCount))}</span>
  `;
}

function renderTripDates(node, match) {
  const selectedDate = getSelectedDate();
  selectedDate.setDate(selectedDate.getDate() + (match.dateOffset || 0));
  const departMinutes = timeToMinutes(match.depart);
  const arriveMinutes = timeToMinutes(match.arrive);
  const arriveDate = getDateForTripTime(selectedDate, arriveMinutes);

  if (arriveMinutes % 1440 < departMinutes % 1440 && arriveMinutes < 1440) {
    arriveDate.setDate(arriveDate.getDate() + 1);
  }

  const departDateLabel = node.querySelector('[data-field="depart-date"]');
  if (departDateLabel) {
    departDateLabel.hidden = true;
    departDateLabel.textContent = "";
  }
  renderTripDateLabel(node.querySelector('[data-field="arrive-date"]'), arriveDate, true);
}

function getDateForTripTime(date, minutes) {
  const tripDate = new Date(date);
  tripDate.setDate(tripDate.getDate() + Math.floor(minutes / 1440));
  return tripDate;
}

function renderTripDateLabel(element, date, alwaysShow = false) {
  if (!element) return;

  const shouldShow = alwaysShow || !isSameCalendarDay(date, new Date());
  element.hidden = !shouldShow;
  element.textContent = shouldShow ? formatShortDate(date) : "";
}

function isSameCalendarDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatShortDate(date) {
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear()
  ].join(".");
}

function formatInputDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatDisplayDate(date) {
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear()
  ].join(".");
}

function parseInputDateValue(value) {
  const text = String(value || "").trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const displayMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);

  if (isoMatch) {
    return createValidatedDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  if (displayMatch) {
    return createValidatedDate(Number(displayMatch[3]), Number(displayMatch[2]), Number(displayMatch[1]));
  }

  return null;
}

function createValidatedDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function getDisplayDateValue(input) {
  const date = parseInputDateValue(input?.value);
  return date ? formatDisplayDate(date) : "";
}

function formatDateTyping(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  const parts = [
    digits.slice(0, 2),
    digits.slice(2, 4),
    digits.slice(4, 8)
  ].filter(Boolean);

  return parts.join(".");
}

function normalizeDateInput(input, fallbackDate = new Date()) {
  if (!input) return fallbackDate;

  const parsedDate = parseInputDateValue(input.value) || fallbackDate;
  input.value = formatDisplayDate(parsedDate);
  return parsedDate;
}

function formatWeekday(date) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short" })
    .format(date)
    .replace(".", "");
}

function formatDayMonth(date) {
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0")
  ].join(".");
}

function renderWarnings(node, match) {
  const warningBox = node.querySelector('[data-field="warning"]');
  const warningEntries = getMatchLegs(match)
    .map((leg) => ({
      line: leg.route.line,
      text: String(leg.trip.warning || "").trim()
    }))
    .filter((entry) => entry.text);

  warningBox.hidden = !warningEntries.length;
  if (!warningEntries.length) return;

  warningBox.innerHTML = `
    <img class="route-warning-icon" src="assets/icons/warning.svg" alt="" aria-hidden="true">
    <div class="route-warning-list">
      ${warningEntries.map((entry) => `
        <div class="route-warning-item">
          <span class="route-warning-line">${escapeHtml(entry.line)}</span>
          <span>${escapeHtml(entry.text)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function setupRouteToggle(node, hasDetails) {
  const toggle = node.querySelector('[data-field="toggle"]');
  const summary = node.querySelector('[data-field="summary"]');
  const details = [...node.querySelectorAll("[data-route-detail]")];

  hasDetails = hasDetails && details.length > 0;
  toggle.hidden = !hasDetails;
  if (!hasDetails) {
    node.querySelector(".route-times").classList.add("route-times-no-toggle");
    return;
  }

  summary.classList.add("is-toggleable");
  summary.addEventListener("click", (event) => {
    if (isTextSelectionActive()) return;
    if (event.target.closest("a, input, select, textarea")) return;
    toggleRouteDetails(node, toggle);
  });
}

function toggleRouteDetails(node, toggle) {
  const willOpen = !node.classList.contains("is-expanded");

  node.classList.toggle("is-expanded", willOpen);
  node.querySelectorAll("[data-route-detail]").forEach((detail) => {
    detail.hidden = !willOpen;
  });
  toggle.classList.toggle("is-open", willOpen);
  toggle.setAttribute("aria-expanded", String(willOpen));
  toggle.setAttribute("aria-label", willOpen ? "Скрыть остановки" : "Показать остановки");
}

function isTextSelectionActive() {
  return Boolean(window.getSelection?.().toString().trim());
}

function renderEmpty(message) {
  currentMatches = [];
  visibleResultsLimit = INITIAL_RESULTS_LIMIT;
  results.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  results.hidden = false;
  resultsActions.hidden = true;
}

function renderRouteLegDetails(leg) {
  const timelineStops = [
    { station: leg.from, time: leg.depart, type: "endpoint start", platform: leg.platform },
    ...leg.intermediateStops.map((stop) => ({ ...stop, type: "middle" })),
    { station: leg.to, time: leg.arrive, type: "endpoint end", platform: leg.arrivalPlatform }
  ];

  return `
    <section class="route-leg-detail" data-route-detail hidden>
      <div class="route-stop-timeline">
        ${timelineStops.map((stop) => `
          <div class="route-stop-row ${stop.type}">
            <time class="route-stop-time">${escapeHtml(stop.time ? formatClockForDisplay(stop.time) : "—")}</time>
            <span class="route-stop-track" aria-hidden="true">
              <span class="route-stop-dot"></span>
            </span>
            <span class="route-stop-name">
              <span>${escapeHtml(stop.station)}</span>
              ${renderPlatformLabel(stop.platform)}
            </span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderTransferWait(currentLeg, nextLeg) {
  const wait = getTransferWaitMinutes(currentLeg, nextLeg);

  return `
    <div class="route-transfer-gap" data-route-detail hidden>
      <img class="route-transfer-icon" src="assets/icons/switch.svg" alt="" aria-hidden="true">
      <span>пересадка ${escapeHtml(formatDuration(wait))}</span>
    </div>
  `;
}

function renderPlatformLabel(platform) {
  if (!hasPlatformValue(platform)) return "";
  return `<span class="route-stop-platform">Путь ${escapeHtml(platform)}</span>`;
}

function hasPlatformValue(platform) {
  return Boolean(platform && platform !== "—");
}

function clearResults() {
  currentMatches = [];
  visibleResultsLimit = INITIAL_RESULTS_LIMIT;
  results.innerHTML = "";
  results.hidden = true;
  resultsActions.hidden = true;
}

function setCurrentDateTime() {
  const now = new Date();
  const today = formatInputDate(now);
  dateInput.value = formatDisplayDate(now);
  selectedScheduleDateValue = today;
  timeInput.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function getSelectedDate() {
  return getDateFromInput(dateInput);
}

function getDateFromInput(input) {
  const value = input?.value || "";
  const parsedDate = parseInputDateValue(value);
  if (parsedDate) return parsedDate;

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getDateTimeForDate(date, time) {
  const minutes = timeToMinutes(time);
  const hours = Math.floor(minutes / 60);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes % 60);
}

function getSelectedDateTime(time, dateOffset = 0) {
  const date = getSelectedDate();
  date.setDate(date.getDate() + dateOffset);

  return getDateTimeForDate(date, time);
}

function getTimeMode() {
  return timeModeInputs.find((input) => input.checked)?.value || "depart";
}

function updateTimeModeLabel() {
  const mode = getTimeMode();
  timeLabel.textContent = mode === "arrive" ? "До" : "После";
  document.querySelector("#time-mode")?.style.setProperty("--time-mode-index", mode === "arrive" ? "1" : "0");
}

function syncTimeModeLabel() {
  updateTimeModeLabel();
  clearResults();
}

function syncScheduleDate() {
  renderScheduleDays();
  renderScheduleTable();
}

function scrollSchedule(direction) {
  if (!scheduleTableShell) return;

  const distance = Math.max(260, scheduleTableShell.clientWidth * 0.82);
  scheduleTableShell.scrollBy({
    left: direction * distance,
    behavior: "smooth"
  });
}

function updateScheduleScrollButtons() {
  if (!scheduleTableShell || !scheduleScrollPrev || !scheduleScrollNext) return;

  const maxScroll = Math.max(0, scheduleTableShell.scrollWidth - scheduleTableShell.clientWidth);
  const hasOverflow = maxScroll > 4;
  const currentScroll = scheduleTableShell.scrollLeft;

  scheduleScrollPrev.disabled = !hasOverflow || currentScroll <= 4;
  scheduleScrollNext.disabled = !hasOverflow || currentScroll >= maxScroll - 4;
}

function startScheduleDrag(event) {
  if (!scheduleTableShell || event.button !== 0) return;

  isScheduleDragging = true;
  scheduleDragStartX = event.clientX;
  scheduleDragStartScroll = scheduleTableShell.scrollLeft;
  scheduleTableShell.classList.add("is-dragging");
  scheduleTableShell.setPointerCapture?.(event.pointerId);
}

function moveScheduleDrag(event) {
  if (!isScheduleDragging || !scheduleTableShell) return;

  const delta = event.clientX - scheduleDragStartX;
  scheduleTableShell.scrollLeft = scheduleDragStartScroll - delta;
}

function stopScheduleDrag(event) {
  if (!isScheduleDragging || !scheduleTableShell) return;

  isScheduleDragging = false;
  scheduleTableShell.classList.remove("is-dragging");
  scheduleTableShell.releasePointerCapture?.(event.pointerId);
}

function isKnownStation(value) {
  const normalized = normalizeStation(value);
  return stations.some((station) => normalizeStation(station) === normalized);
}

function normalizeStation(value) {
  return String(value || "").trim().toLowerCase();
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToClock(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function minutesToServiceClock(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatClockForDisplay(time) {
  return minutesToClock(timeToMinutes(time));
}

function durationBetween(start, end) {
  let duration = timeToMinutes(end) - timeToMinutes(start);
  if (duration < 0) duration += 1440;
  return duration;
}

function formatDuration(totalMinutes) {
  const minutes = Number(totalMinutes) || 0;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours <= 0) return `${restMinutes} мин`;
  if (restMinutes <= 0) return `${hours} ч`;
  return `${hours} ч ${restMinutes} мин`;
}

function formatTransferInfo(count) {
  if (!count) return "прямой";
  return `${count} ${pluralizeRu(count, ["пересадка", "пересадки", "пересадок"])}`;
}

function pluralizeRu(number, forms) {
  const absolute = Math.abs(number) % 100;
  const lastDigit = absolute % 10;

  if (absolute > 10 && absolute < 20) return forms[2];
  if (lastDigit > 1 && lastDigit < 5) return forms[1];
  if (lastDigit === 1) return forms[0];
  return forms[2];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

routeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  hideStationOptions(fromInput);
  hideStationOptions(toInput);
  normalizeDateInput(dateInput);
  if (!validateSearchFields()) return;

  if (isRedirectSearch) {
    redirectToSearchPage();
    return;
  }

  updateSearchUrl();
  runSearch();
});

swapButton.addEventListener("click", () => {
  const oldFrom = fromInput.value;
  fromInput.value = toInput.value;
  toInput.value = oldFrom;
  clearResults();
});

loadMoreButton.addEventListener("click", () => {
  visibleResultsLimit = Math.min(visibleResultsLimit + RESULTS_INCREMENT, MAX_RESULTS_LIMIT);
  renderRouteResults();
});

dateInput.addEventListener("input", () => {
  dateInput.value = formatDateTyping(dateInput.value);
  clearResults();
});
dateInput.addEventListener("blur", () => {
  normalizeDateInput(dateInput);
});
dateInput.addEventListener("change", clearResults);
timeInput.addEventListener("change", clearResults);
timeModeInputs.forEach((input) => input.addEventListener("change", syncTimeModeLabel));
scheduleDays?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-date]");
  if (!button) return;

  selectedScheduleDateValue = button.dataset.date;
  syncScheduleDate();
});

scheduleScrollPrev?.addEventListener("click", () => scrollSchedule(-1));
scheduleScrollNext?.addEventListener("click", () => scrollSchedule(1));
scheduleTableShell?.addEventListener("scroll", updateScheduleScrollButtons, { passive: true });
scheduleTableShell?.addEventListener("pointerdown", startScheduleDrag);
scheduleTableShell?.addEventListener("pointermove", moveScheduleDrag);
scheduleTableShell?.addEventListener("pointerup", stopScheduleDrag);
scheduleTableShell?.addEventListener("pointercancel", stopScheduleDrag);
scheduleTableShell?.addEventListener("pointerleave", stopScheduleDrag);
window.addEventListener("resize", updateScheduleScrollButtons);
