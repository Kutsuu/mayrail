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
const isRedirectSearch = routeForm.dataset.searchMode === "redirect";

const INITIAL_RESULTS_LIMIT = 3;
const RESULTS_INCREMENT = 2;
const MAX_RESULTS_LIMIT = 5;

let routeData = { routes: [] };
let stations = [];
let currentMatches = [];
let visibleResultsLimit = INITIAL_RESULTS_LIMIT;

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
    if (applySearchParams() && !isRedirectSearch) {
      runSearch();
    }
  } catch (error) {
    renderEmpty("Расписание сейчас недоступно.");
    console.error(error);
  }
}

async function loadRouteData() {
  const source = window.MAYRAIL_DATA_URL || routeForm.dataset.routesSource || "data/routes.csv";

  try {
    const response = await fetch(source, { cache: "no-store" });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Data request failed: ${response.status}`);
    }

    return csvToRouteData(text);
  } catch (error) {
    const inlineCsv = getInlineRouteCsv();

    if (inlineCsv) {
      return csvToRouteData(inlineCsv);
    }

    throw error;
  }
}

function getInlineRouteCsv() {
  const inlineSource = document.querySelector("#routes-csv-fallback");
  return inlineSource?.textContent?.trim() || "";
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
  return header[0] === "предупреждение"
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
  const startIndex = stations.findIndex((station) => normalizeStation(station) === normalizeStation(routeParts[0]));
  const endIndex = stations.findIndex((station) => normalizeStation(station) === normalizeStation(routeParts.at(-1)));

  if (startIndex === -1 || endIndex === -1) {
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

  const minutes = timeToMinutes(time);
  const previousMinutes = timeToMinutes(previousTime);

  if (minutes < previousMinutes && minutes + 60 >= previousMinutes) {
    return minutesToClock(minutes + 60);
  }

  return time;
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
    renderStationOptions(input);
    clearResults();
  });
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
  const visibleStations = filteredStations.length ? filteredStations : stations;

  picker.activeIndex = clamp(picker.activeIndex, 0, visibleStations.length - 1);
  picker.list.innerHTML = visibleStations
    .map((station, index) => `
      <button class="station-option" type="button" role="option" data-value="${escapeHtml(station)}" aria-selected="${index === picker.activeIndex}">
        ${escapeHtml(station)}
      </button>
    `)
    .join("");

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

  if (!stations.length) {
    renderEmpty("Расписание сейчас недоступно.");
    return;
  }

  if (!from || !to || from === to) {
    renderEmpty("Выберите разные станции отправления и прибытия.");
    return;
  }

  if (!isKnownStation(fromInput.value) || !isKnownStation(toInput.value)) {
    renderEmpty("Выберите станцию из списка.");
    return;
  }

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

function findRouteMatches(from, to, time, timeMode, dateOffset) {
  return routeData.routes
    .flatMap((route) => buildRouteMatches(route, from, to, time, timeMode, dateOffset))
    .sort((a, b) => sortMatchesByTime(a, b, timeMode))
    .slice(0, MAX_RESULTS_LIMIT);
}

function buildSearchParams() {
  const params = new URLSearchParams();
  const values = {
    from: fromInput.value.trim(),
    to: toInput.value.trim(),
    date: dateInput.value,
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
  if (date) dateInput.value = date;
  if (time) timeInput.value = time;

  const selectedTimeMode = timeModeInputs.find((input) => input.value === timeMode);
  if (selectedTimeMode) selectedTimeMode.checked = true;
  updateTimeModeLabel();

  return Boolean(from && to);
}

function redirectToSearchPage() {
  const target = routeForm.dataset.resultsPage || "search.html";
  const params = buildSearchParams();
  window.location.href = `${target}?${params.toString()}`;
}

function updateSearchUrl() {
  if (!window.history?.replaceState) return;

  const url = new URL(window.location.href);
  url.search = buildSearchParams().toString();
  window.history.replaceState(null, "", url);
}

function buildRouteMatches(route, from, to, time, timeMode, dateOffset = 0) {
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
    .map(markPastMatch)
    .filter((match) => isMatchInTimeWindow(match, time, timeMode));
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
  node.querySelector(".line-pill").textContent = match.route.line;
  node.querySelector('[data-field="direction"]').textContent = match.route.direction || `${match.route.from} - ${match.route.to}`;
  node.querySelector('[data-field="depart"]').textContent = match.depart;
  node.querySelector('[data-field="arrive"]').textContent = match.arrive;
  renderTripDates(node, match);
  renderWarning(node, match.trip.warning);

  const duration = durationBetween(match.depart, match.arrive);
  renderRouteLine(node.querySelector(".route-line"), duration);
  setupRouteToggle(node, renderIntermediateStops(node.querySelector('[data-field="stops"]'), match));
  results.appendChild(node);
}

function renderRouteLine(container, duration) {
  container.innerHTML = `
    <span class="route-duration">${duration} мин</span>
    <span class="route-rail"></span>
  `;
}

function renderTripDates(node, match) {
  const selectedDate = getSelectedDate();
  selectedDate.setDate(selectedDate.getDate() + (match.dateOffset || 0));
  const departMinutes = timeToMinutes(match.depart);
  const arriveMinutes = timeToMinutes(match.arrive);
  const departDate = getDateForTripTime(selectedDate, departMinutes);
  const arriveDate = getDateForTripTime(selectedDate, arriveMinutes);

  if (arriveMinutes % 1440 < departMinutes % 1440 && arriveMinutes < 1440) {
    arriveDate.setDate(arriveDate.getDate() + 1);
  }

  renderTripDateLabel(node.querySelector('[data-field="depart-date"]'), departDate, false);
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

function renderWarning(node, warning) {
  const warningBox = node.querySelector('[data-field="warning"]');
  const warningText = node.querySelector('[data-field="warning-text"]');
  const message = String(warning || "").trim();

  warningBox.hidden = !message;
  warningText.textContent = message;
}

function setupRouteToggle(node, hasDetails) {
  const toggle = node.querySelector('[data-field="toggle"]');
  const details = node.querySelector('[data-field="stops"]');
  const summary = node.querySelector('[data-field="summary"]');

  toggle.hidden = !hasDetails;
  if (!hasDetails) {
    node.querySelector(".route-times").classList.add("route-times-no-toggle");
    return;
  }

  summary.classList.add("is-toggleable");
  summary.addEventListener("click", (event) => {
    if (isTextSelectionActive()) return;
    if (event.target.closest("a, input, select, textarea")) return;
    toggleRouteDetails(details, toggle);
  });
}

function toggleRouteDetails(details, toggle) {
  const willOpen = details.hidden;

  details.hidden = !willOpen;
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

function renderIntermediateStops(container, match) {
  const intermediateStops = match.intermediateStops;
  const timelineStops = [
    { station: match.from, time: match.depart, type: "endpoint start", platform: match.platform },
    ...intermediateStops.map((stop) => ({ ...stop, type: "middle" })),
    { station: match.to, time: match.arrive, type: "endpoint end", platform: match.arrivalPlatform }
  ];
  container.innerHTML = `
    <div class="route-stop-timeline">
      ${timelineStops.map((stop) => `
        <div class="route-stop-row ${stop.type}">
          <time class="route-stop-time">${escapeHtml(stop.time || "—")}</time>
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
  `;
  container.hidden = true;
  return true;
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
  dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  timeInput.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function getSelectedDate() {
  const match = String(dateInput.value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getSelectedDateTime(time, dateOffset = 0) {
  const date = getSelectedDate();
  date.setDate(date.getDate() + dateOffset);
  const minutes = timeToMinutes(time);
  const hours = Math.floor(minutes / 60);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes % 60);
}

function getTimeMode() {
  return timeModeInputs.find((input) => input.checked)?.value || "depart";
}

function updateTimeModeLabel() {
  timeLabel.textContent = getTimeMode() === "arrive" ? "До" : "После";
}

function syncTimeModeLabel() {
  updateTimeModeLabel();
  clearResults();
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

function durationBetween(start, end) {
  let duration = timeToMinutes(end) - timeToMinutes(start);
  if (duration < 0) duration += 1440;
  return duration;
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

dateInput.addEventListener("change", clearResults);
timeInput.addEventListener("change", clearResults);
timeModeInputs.forEach((input) => input.addEventListener("change", syncTimeModeLabel));
