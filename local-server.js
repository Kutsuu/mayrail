const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");

const root = __dirname;
const defaultPort = Number(process.env.PORT) || 8000;
const host = process.env.HOST || "0.0.0.0";
const maxPortAttempts = 20;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function createServer() {
  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://localhost");
    const pathname = decodeURIComponent(requestUrl.pathname);
    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.normalize(path.join(root, requestedPath));
    const rootPath = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

    if (!filePath.startsWith(rootPath)) {
      sendText(response, 403, "Forbidden");
      return;
    }

    fs.stat(filePath, (statError, stats) => {
      if (statError || !stats.isFile()) {
        sendText(response, 404, "Not found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      response.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      fs.createReadStream(filePath).pipe(response);
    });
  });
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function startServer(port, attempt = 0) {
  const server = createServer();

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attempt < maxPortAttempts) {
      startServer(port + 1, attempt + 1);
      return;
    }

    console.error(error);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    const localUrl = `http://localhost:${port}/`;
    const networkUrls = getNetworkUrls(port);

    console.log(`Mayrail local server: ${localUrl}`);
    if (networkUrls.length > 0) {
      console.log("Local network:");
      networkUrls.forEach((url) => console.log(`  ${url}`));
    }
    console.log("Press Ctrl+C to stop.");

    if (process.env.OPEN_BROWSER === "1") {
      openBrowser(localUrl);
    }
  });
}

function getNetworkUrls(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((network) => network && network.family === "IPv4" && !network.internal)
    .map((network) => `http://${network.address}:${port}/`);
}

function openBrowser(url) {
  const command = process.platform === "win32"
    ? `start "" "${url}"`
    : process.platform === "darwin"
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(command, () => {});
}

startServer(defaultPort);
