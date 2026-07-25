import assert from "node:assert/strict";
import fs from "node:fs";

const read = relativePath => fs.readFileSync(
  new URL(`../${relativePath}`, import.meta.url),
  "utf8"
);

const app = read("assets/js/app.js");
const firebase = read("assets/js/firebase-content.js");
const sections = read("assets/js/site-sections.js");
const projects = read("assets/js/projects.js");
const localServer = read("local-server.js");

for (const page of ["index.html", "passengers.html"]) {
  const html = read(page);
  assert.match(html, /assets\/js\/firebase-content\.js/);
  assert.match(html, /assets\/js\/public-schedule\.js/);
  assert.match(html, /assets\/js\/app\.js/);
  assert.match(html, /id="public-data-warning"/);
  assert.ok(
    html.indexOf("public-schedule.js") < html.indexOf("app.js"),
    `${page}: the schedule adapter must load before app.js`
  );
}

assert.match(app, /MAYRAIL_PUBLIC_SCHEDULE/);
assert.match(app, /function getTripStopAtIndex/);
assert.match(app, /const indexPairs = normalizedStops\.flatMap/);
assert.doesNotMatch(app, /operationsByOrdinal/);
assert.match(firebase, /mayrail-public-schedules-v1/);
assert.match(firebase, /where\("scheduleId", "in", ids\)/);
assert.match(firebase, /subscribePassengerSchedules/);
assert.match(firebase, /onSnapshot\(/);
assert.match(firebase, /includeMetadataChanges:\s*true/);
assert.match(firebase, /clientPromise\s*=\s*null/);
assert.match(firebase, /requests\.delete\(kind\)/);
assert.match(firebase, /reconnectTimer\s*=\s*setTimeout/);
assert.match(firebase, /snapshot\.metadata\?\.fromCache && snapshot\.empty/);
assert.match(firebase, /getScheduleSource/);
assert.match(app, /startFirebaseScheduleSubscription/);
assert.match(app, /preserveInputs:\s*true/);
assert.match(app, /Number\(match\[1\]\) <= 23/);
assert.match(app, /Array\.isArray\(manifest\?\.files\)/);
assert.match(app, /const routeItems = Array\.isArray\(routes\)/);
assert.match(app, /if \(cached\?\.text\) return cached\.text/);
assert.match(sections, /data-history-image/);
assert.match(sections, /HISTORY_IMAGE_PLACEHOLDER/);
assert.match(sections, /function publicImageUrl/);
assert.match(sections, /Array\.isArray\(loaded\)/);
assert.match(projects, /applyNextFallback/);
assert.match(projects, /if \(cached\?\.text\) return cached\.text/);
assert.match(localServer, /decodeURIComponent[\s\S]*catch/);
assert.match(localServer, /X-Content-Type-Options/);
assert.match(localServer, /stream\.on\("error"/);

console.log("static-integration.test.mjs: OK");
