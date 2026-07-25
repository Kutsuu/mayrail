(() => {
  "use strict";

  const MINUTES_PER_DAY = 24 * 60;

  function text(value) {
    return String(value ?? "").trim();
  }

  function normalizeTime(value) {
    const match = text(value).match(/^(\d{1,2}):([0-5]\d)$/);
    if (!match || Number(match[1]) > 23) return "";
    return `${match[1].padStart(2, "0")}:${match[2]}`;
  }

  function timeMinutes(value) {
    const normalized = normalizeTime(value);
    if (!normalized) return null;
    const [hours, minutes] = normalized.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function shiftTime(value, deltaMinutes) {
    const sourceMinutes = timeMinutes(value);
    if (sourceMinutes === null) return "";
    const requestedDelta = Number(deltaMinutes);
    const safeDelta = Number.isFinite(requestedDelta) ? requestedDelta : 0;
    const shifted = ((sourceMinutes + safeDelta) % MINUTES_PER_DAY + MINUTES_PER_DAY)
      % MINUTES_PER_DAY;
    return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(shifted % 60).padStart(2, "0")}`;
  }

  function timeDelta(scheduled, effective) {
    const scheduledMinutes = timeMinutes(scheduled);
    const effectiveMinutes = timeMinutes(effective);
    if (scheduledMinutes === null || effectiveMinutes === null) return null;
    let delta = effectiveMinutes - scheduledMinutes;
    if (delta < -MINUTES_PER_DAY / 2) delta += MINUTES_PER_DAY;
    if (delta > MINUTES_PER_DAY / 2) delta -= MINUTES_PER_DAY;
    return delta;
  }

  function stationKey(value) {
    return text(value).toLocaleLowerCase("ru-RU");
  }

  function operationKey(station, ordinal) {
    return `${stationKey(station)}\u0000${ordinal}`;
  }

  function applyOperations(stops = [], operations = []) {
    const operationsByStop = new Map();
    const operationItems = Array.isArray(operations) ? operations : [];
    operationItems.forEach((operation) => {
      const ordinal = Number(operation?.stationOrdinal);
      const station = text(operation?.station);
      if (!station || !Number.isInteger(ordinal) || ordinal < 0) return;
      operationsByStop.set(operationKey(station, ordinal), operation);
    });

    const stationOrdinals = new Map();
    let carriedDelayMinutes = 0;

    return (Array.isArray(stops) ? stops : []).map((sourceStop) => {
      const stop = sourceStop && typeof sourceStop === "object" ? sourceStop : {};
      const station = text(stop.station);
      const normalizedStation = stationKey(station);
      const ordinal = stationOrdinals.get(normalizedStation) || 0;
      stationOrdinals.set(normalizedStation, ordinal + 1);

      const operation = operationsByStop.get(operationKey(station, ordinal));
      const scheduledArrival = normalizeTime(stop.arrival);
      const scheduledDeparture = normalizeTime(stop.departure);
      const explicitArrival = normalizeTime(operation?.arrival);
      const explicitDeparture = normalizeTime(operation?.departure);
      const authoritative = operation?.marked === true || Boolean(explicitArrival || explicitDeparture);

      const arrival = scheduledArrival
        ? authoritative
          ? explicitArrival || scheduledArrival
          : shiftTime(scheduledArrival, carriedDelayMinutes)
        : "";
      const departure = scheduledDeparture
        ? authoritative
          ? explicitDeparture || scheduledDeparture
          : shiftTime(scheduledDeparture, carriedDelayMinutes)
        : "";

      if (authoritative) {
        const departureDelta = timeDelta(scheduledDeparture, departure);
        const arrivalDelta = timeDelta(scheduledArrival, arrival);
        if (Number.isFinite(departureDelta)) carriedDelayMinutes = departureDelta;
        else if (Number.isFinite(arrivalDelta)) carriedDelayMinutes = arrivalDelta;
      }

      return {
        ...stop,
        arrival,
        departure,
        track: typeof operation?.track === "string"
          ? text(operation.track)
          : text(stop.track)
      };
    });
  }

  window.MAYRAIL_PUBLIC_SCHEDULE = Object.freeze({
    applyOperations,
    normalizeTime,
    shiftTime,
    timeDelta
  });
})();
