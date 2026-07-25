import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../assets/js/public-schedule.js", import.meta.url),
  "utf8"
);
const window = {};
vm.runInNewContext(source, { window });
const adapter = window.MAYRAIL_PUBLIC_SCHEDULE;

assert.ok(adapter, "Public schedule adapter was not initialized");

const ordinaryStops = [
  { station: "Колодец", departure: "09:00", track: "1" },
  { station: "Песочница", arrival: "09:05", departure: "09:05", track: "1" },
  { station: "Первомайск", arrival: "09:10", track: "2" }
];
const delayed = adapter.applyOperations(ordinaryStops, [{
  station: "Песочница",
  stationOrdinal: 0,
  marked: true,
  arrival: "09:10",
  departure: "09:10",
  track: "3"
}]);

assert.deepEqual(JSON.parse(JSON.stringify(delayed)), [
  { station: "Колодец", arrival: "", departure: "09:00", track: "1" },
  { station: "Песочница", arrival: "09:10", departure: "09:10", track: "3" },
  { station: "Первомайск", arrival: "09:15", departure: "", track: "2" }
]);

const repeated = adapter.applyOperations([
  { station: "А", departure: "23:50" },
  { station: "Б", arrival: "23:55", departure: "23:55" },
  { station: "А", arrival: "00:05" }
], [{
  station: "А",
  stationOrdinal: 1,
  marked: true,
  arrival: "00:12",
  track: "II"
}]);

assert.equal(
  repeated[0].departure,
  "23:50",
  "The second occurrence must not alter the first stop"
);
assert.equal(repeated[2].arrival, "00:12");
assert.equal(repeated[2].track, "II");
assert.equal(adapter.timeDelta("23:58", "00:03"), 5);
assert.equal(adapter.shiftTime("23:58", 5), "00:03");
assert.equal(
  adapter.shiftTime("10:15", Infinity),
  "10:15",
  "Non-finite delay must not corrupt a valid time"
);
assert.doesNotThrow(() => adapter.applyOperations([], {}));
assert.deepEqual(
  JSON.parse(JSON.stringify(adapter.applyOperations(
    [{ station: "А", arrival: "10:00" }],
    { damaged: true }
  ))),
  [{ station: "А", arrival: "10:00", departure: "", track: "" }]
);

let fuzzSeed = 0x9e3779b9;
const fuzzRandom = () => {
  fuzzSeed = (Math.imul(fuzzSeed, 1664525) + 1013904223) >>> 0;
  return fuzzSeed / 0x100000000;
};
const fuzzAtom = () => [
  null,
  undefined,
  false,
  true,
  0,
  NaN,
  Infinity,
  "",
  "99:99",
  "00:00",
  {}
][Math.floor(fuzzRandom() * 11)];

for (let index = 0; index < 2000; index += 1) {
  const stops = fuzzRandom() > 0.35
    ? Array.from({ length: Math.floor(fuzzRandom() * 8) }, () => ({
      station: fuzzAtom(),
      arrival: fuzzAtom(),
      departure: fuzzAtom(),
      track: fuzzAtom()
    }))
    : fuzzAtom();
  const operations = fuzzRandom() > 0.35
    ? Array.from({ length: Math.floor(fuzzRandom() * 8) }, () => ({
      station: fuzzAtom(),
      stationOrdinal: fuzzAtom(),
      arrival: fuzzAtom(),
      departure: fuzzAtom(),
      track: fuzzAtom(),
      marked: fuzzAtom()
    }))
    : fuzzAtom();
  assert.doesNotThrow(
    () => adapter.applyOperations(stops, operations),
    `Malformed public schedule corpus item ${index} must not crash`
  );
}

console.log("public-schedule.test.mjs: OK");
