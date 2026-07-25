(() => {
  "use strict";

  const CACHE_KEY = "mayrail-public-site-content-v1";
  const SCHEDULE_CACHE_KEY = "mayrail-public-schedules-v1";
  const REQUEST_TIMEOUT_MS = 8000;
  const SDK_VERSION = "12.16.0";
  const FIREBASE_CONFIG = Object.freeze({
    apiKey: "AIzaSyDI1kFRuhemC1bgH1R4UoiVbyHKzQoEvUg",
    authDomain: "mayrail-2310d.firebaseapp.com",
    projectId: "mayrail-2310d",
    storageBucket: "mayrail-2310d.firebasestorage.app",
    messagingSenderId: "1035588130335",
    appId: "1:1035588130335:web:52012be082e11d0840272a"
  });

  let clientPromise;
  let scheduleRequestPromise;
  let scheduleSource = "network";
  const requests = new Map();

  function readCache(kind) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
      return Array.isArray(cache[kind]) ? cache[kind] : null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(kind, items) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
      cache[kind] = items;
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_) {
      // The current response remains usable when local storage is unavailable.
    }
  }

  function readScheduleCache() {
    try {
      const items = JSON.parse(localStorage.getItem(SCHEDULE_CACHE_KEY) || "null");
      return Array.isArray(items) ? items : null;
    } catch (_) {
      return null;
    }
  }

  function writeScheduleCache(items) {
    try {
      localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(items));
    } catch (_) {
      // The current response remains usable when local storage is unavailable.
    }
  }

  async function getClient() {
    if (clientPromise) return clientPromise;
    clientPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`)
    ]).then(([appSdk, firestoreSdk]) => {
      const app = appSdk.getApps().length
        ? appSdk.getApp()
        : appSdk.initializeApp(FIREBASE_CONFIG);
      return {
        db: firestoreSdk.getFirestore(app),
        firestoreSdk
      };
    }).catch((error) => {
      // A failed CDN request must not poison all later attempts in this tab.
      clientPromise = null;
      throw error;
    });
    return clientPromise;
  }

  function load(kind) {
    if (![
      "news",
      "projects",
      "history",
      "vacancies",
      "passengerInfo",
      "companyInfo"
    ].includes(kind)) {
      throw new Error("Unknown site content section");
    }
    if (requests.has(kind)) return requests.get(kind);
    const requestPromise = (async () => {
      try {
        const snapshot = await withTimeout(loadContentSnapshot(kind));
        const items = snapshot.docs.map(document => ({
          id: document.id,
          ...document.data()
        }));
        writeCache(kind, items);
        return items;
      } catch (error) {
        const cached = readCache(kind);
        if (cached) return cached;
        throw error;
      }
    })();
    requests.set(kind, requestPromise);
    void requestPromise.catch(() => {
      if (requests.get(kind) === requestPromise) requests.delete(kind);
    });
    return requestPromise;
  }

  async function loadContentSnapshot(kind) {
    const { db, firestoreSdk } = await getClient();
    const request = firestoreSdk.query(
      firestoreSdk.collection(db, "publicSiteContent"),
      firestoreSdk.where("kind", "==", kind)
    );
    const snapshot = await firestoreSdk.getDocs(request);
    if (snapshot.metadata?.fromCache && snapshot.empty) {
      throw new Error("Firebase content is unavailable offline");
    }
    return snapshot;
  }

  async function loadPassengerSchedules() {
    if (scheduleRequestPromise) return scheduleRequestPromise;
    scheduleRequestPromise = withTimeout(loadPassengerSchedulesFromServer()).catch((error) => {
      const cached = readScheduleCache();
      if (cached) {
        scheduleSource = "cache";
        return cached;
      }
      scheduleRequestPromise = null;
      throw error;
    });
    return scheduleRequestPromise;
  }

  function subscribePassengerSchedules(onData, onError) {
    let active = true;
    let scheduleUnsubscribe = null;
    let operationUnsubscribes = [];
    let generation = 0;
    let reconnectTimer = null;

    const stopOperationSubscriptions = () => {
      operationUnsubscribes.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (_) {}
      });
      operationUnsubscribes = [];
    };

    const connect = () => {
      void getClient().then(({ db, firestoreSdk }) => {
      if (!active) return;
      let scheduleDocuments = [];
      let scheduleFromCache = false;
      let operationGroups = new Map();
      let operationCacheStates = new Map();

      const publish = () => {
        if (!active) return;
        const schedules = combinePassengerSchedules(
          scheduleDocuments,
          [...operationGroups.values()].flat()
        );
        const fromCache = scheduleFromCache ||
          [...operationCacheStates.values()].some(Boolean);
        scheduleSource = fromCache ? "cache" : "network";
        if (!fromCache || schedules.length) writeScheduleCache(schedules);
        onData?.(schedules, { fromCache });
      };

      const subscribeOperations = () => {
        generation += 1;
        const currentGeneration = generation;
        stopOperationSubscriptions();
        operationGroups = new Map();
        operationCacheStates = new Map();
        const portions = chunk(
          scheduleDocuments.map(document => document.id),
          30
        );
        if (!portions.length) {
          publish();
          return;
        }
        const initializedGroups = new Set();
        operationUnsubscribes = portions.map((ids, groupIndex) =>
          firestoreSdk.onSnapshot(
            firestoreSdk.query(
              firestoreSdk.collection(db, "publicOperations"),
              firestoreSdk.where("scheduleId", "in", ids)
            ),
            { includeMetadataChanges: true },
            snapshot => {
              if (!active || currentGeneration !== generation) return;
              operationGroups.set(groupIndex, snapshot.docs);
              operationCacheStates.set(
                groupIndex,
                snapshot.metadata?.fromCache === true
              );
              initializedGroups.add(groupIndex);
              if (initializedGroups.size === portions.length) publish();
            },
            error => {
              if (!active || currentGeneration !== generation) return;
              operationGroups.set(groupIndex, []);
              operationCacheStates.set(groupIndex, true);
              initializedGroups.add(groupIndex);
              if (initializedGroups.size === portions.length) publish();
              onError?.(error);
            }
          )
        );
      };

      let previousScheduleIds = "";
      scheduleUnsubscribe = firestoreSdk.onSnapshot(
        firestoreSdk.collection(db, "publicSchedules"),
        { includeMetadataChanges: true },
        snapshot => {
          if (!active) return;
          if (
            snapshot.metadata?.fromCache &&
            snapshot.empty &&
            readScheduleCache()?.length
          ) return;
          scheduleDocuments = snapshot.docs;
          scheduleFromCache = snapshot.metadata?.fromCache === true;
          const nextScheduleIds = scheduleDocuments
            .map(document => document.id)
            .join("\u0000");
          if (nextScheduleIds !== previousScheduleIds) {
            previousScheduleIds = nextScheduleIds;
            subscribeOperations();
          } else {
            publish();
          }
        },
        error => {
          if (active) onError?.(error);
        }
      );
      }).catch((error) => {
        if (!active) return;
        onError?.(error);
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 5000);
        }
      });
    };
    connect();

    return () => {
      active = false;
      generation += 1;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      scheduleUnsubscribe?.();
      stopOperationSubscriptions();
    };
  }

  function withTimeout(promise, timeoutMs = REQUEST_TIMEOUT_MS) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Firebase request timed out")),
        timeoutMs
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }

  async function loadPassengerSchedulesFromServer() {
    const { db, firestoreSdk } = await getClient();
    const scheduleSnapshot = await firestoreSdk.getDocs(
      firestoreSdk.collection(db, "publicSchedules")
    );
    if (scheduleSnapshot.metadata?.fromCache) {
      const cached = readScheduleCache();
      if (cached?.length) {
        scheduleSource = "cache";
        return cached;
      }
    }
    if (scheduleSnapshot.metadata?.fromCache && scheduleSnapshot.empty) {
      throw new Error("Firebase schedules are unavailable offline");
    }
    const scheduleIds = scheduleSnapshot.docs.map(document => document.id);
    const operationSnapshots = await Promise.all(chunk(scheduleIds, 30).map(ids =>
      firestoreSdk.getDocs(firestoreSdk.query(
        firestoreSdk.collection(db, "publicOperations"),
        firestoreSdk.where("scheduleId", "in", ids)
      ))
    ));

    const schedules = combinePassengerSchedules(
      scheduleSnapshot.docs,
      operationSnapshots.flatMap(snapshot => snapshot.docs)
    );
    scheduleSource = "network";
    writeScheduleCache(schedules);
    return schedules;
  }

  function combinePassengerSchedules(scheduleDocuments, operationDocuments) {
    const operationsBySchedule = new Map();
    operationDocuments.forEach((document) => {
      const item = { id: document.id, ...document.data() };
      const scheduleId = String(item.scheduleId || "").trim();
      if (!scheduleId) return;

      const operations = operationsBySchedule.get(scheduleId) || [];
      operations.push(item);
      operationsBySchedule.set(scheduleId, operations);
    });

    return scheduleDocuments
      .map((document) => {
        const item = { id: document.id, ...document.data() };
        return {
          ...item,
          operations: operationsBySchedule.get(document.id) || []
        };
      })
      .sort(sortPassengerSchedules);
  }

  function chunk(items, size) {
    const portions = [];
    for (let index = 0; index < items.length; index += size) {
      portions.push(items.slice(index, index + size));
    }
    return portions;
  }

  function sortPassengerSchedules(left, right) {
    const dateOrder = String(left.date || "").localeCompare(String(right.date || ""));
    if (dateOrder) return dateOrder;

    return getFirstScheduleTime(left).localeCompare(getFirstScheduleTime(right))
      || String(left.trainNumber || "").localeCompare(String(right.trainNumber || ""), "ru", { numeric: true });
  }

  function getFirstScheduleTime(schedule) {
    const firstStop = Array.isArray(schedule.stops)
      ? schedule.stops.find((stop) => stop?.departure || stop?.arrival)
      : null;

    return String(firstStop?.departure || firstStop?.arrival || "");
  }

  window.MAYRAIL_FIREBASE_CONTENT = Object.freeze({
    load,
    loadPassengerSchedules,
    subscribePassengerSchedules,
    getScheduleSource: () => scheduleSource
  });
})();
