import assert from "node:assert/strict";

const port = Number(process.argv[2] || 9225);
const baseUrl = process.argv[3] || "http://127.0.0.1:8010/";
const pages = await fetch(`http://127.0.0.1:${port}/json/list`)
  .then(response => response.json());
const page = pages.find(item => item.type === "page");
assert.ok(page, "No browser page is available through CDP");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let commandId = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(
      message.params?.exceptionDetails?.exception?.description ||
      message.params?.exceptionDetails?.text ||
      "Unknown runtime exception"
    );
  }
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function command(method, params = {}) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text
    );
  }
  return result.result.value;
}

async function waitFor(expression, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await evaluate(expression)) return;
    } catch (_) {
      // Navigation may temporarily destroy the JavaScript execution context.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

await command("Page.enable");
await command("Runtime.enable");

const paths = [
  "index.html",
  "passengers.html",
  "information.html",
  "news.html",
  "projects.html",
  "about.html",
  "join.html",
  "support.html",
  "search.html",
  "404.html"
];
const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 }
];
let checkedStates = 0;

for (const path of paths) {
  runtimeErrors.length = 0;
  await command("Page.navigate", { url: new URL(path, baseUrl).href });
  await waitFor(
    `document.readyState === "complete"`,
    `${path}: page did not finish loading`
  );
  await new Promise(resolve => setTimeout(resolve, 350));

  for (const viewport of viewports) {
    await command("Emulation.setDeviceMetricsOverride", {
      ...viewport,
      deviceScaleFactor: 1,
      mobile: viewport.width <= 768
    });
    const layout = await evaluate(`(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0;
      };
      const fixedOutsideViewport = [...document.querySelectorAll("*")]
        .filter(element => visible(element) &&
          ["fixed", "sticky"].includes(getComputedStyle(element).position))
        .flatMap(element => {
          const insideScroller = (() => {
            let parent = element.parentElement;
            while (parent && parent !== document.body) {
              const style = getComputedStyle(parent);
              if (
                parent.scrollWidth > parent.clientWidth + 1 &&
                ["auto", "scroll"].includes(style.overflowX)
              ) return true;
              parent = parent.parentElement;
            }
            return false;
          })();
          if (insideScroller) return [];
          const rect = element.getBoundingClientRect();
          const outside = rect.right < -2 ||
            rect.left > innerWidth + 2 ||
            rect.bottom < -2 ||
            rect.top > innerHeight + 2;
          return outside ? [element.tagName + "." + element.className] : [];
        })
        .slice(0, 5);
      return {
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        fixedOutsideViewport,
        bodyText: document.body?.innerText?.trim().length || 0
      };
    })()`);
    assert.ok(
      layout.documentWidth <= layout.viewport + 2,
      `${path} at ${viewport.width}px: body overflows horizontally ` +
      `(${layout.documentWidth}px > ${layout.viewport}px)`
    );
    assert.deepEqual(
      layout.fixedOutsideViewport,
      [],
      `${path} at ${viewport.width}px: fixed/sticky element is outside viewport`
    );
    assert.ok(layout.bodyText > 0, `${path}: page rendered without content`);
    checkedStates += 1;
  }

  assert.deepEqual(
    runtimeErrors,
    [],
    `${path}: uncaught browser exception`
  );
}

await command("Page.navigate", {
  url: new URL("passengers.html", baseUrl).href
});
await waitFor(
  `document.readyState === "complete" &&
   Boolean(window.MAYRAIL_FIREBASE_CONTENT)`,
  "Passenger page did not initialize Firebase client"
);
runtimeErrors.length = 0;
await evaluate(`(() => {
  localStorage.setItem("mayrail-public-schedules-v1", "{damaged");
  localStorage.setItem("mayrail-public-site-content-v1", "{damaged");
  location.reload();
  return true;
})()`);
await waitFor(
  `document.readyState === "complete" &&
   Boolean(window.MAYRAIL_FIREBASE_CONTENT)`,
  "Passenger page failed after corrupt-cache reload"
);
await new Promise(resolve => setTimeout(resolve, 500));
assert.deepEqual(
  runtimeErrors,
  [],
  "Corrupt local cache caused an uncaught browser exception"
);

socket.close();
console.log(
  `browser-smoke.mjs: OK (${checkedStates} layout states + corrupt-cache reload)`
);
