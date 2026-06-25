import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import worker from "../../worker.mjs";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function safeAssetPath(pathname) {
  const trimmed = pathname === "/" ? "/index.html" : pathname;
  const withIndex = trimmed.endsWith("/") ? `${trimmed}index.html` : trimmed;
  const normalized = normalize(withIndex).replace(/^(\.\.[/\\])+/, "");
  return join(root, normalized.replace(/^[/\\]+/, ""));
}

async function assetFetch(request) {
  const url = new URL(request.url);
  const path = safeAssetPath(url.pathname);
  if (!existsSync(path) || !statSync(path).isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const body = await readFile(path);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": MIME[extname(path)] || "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}

const env = {
  ASSETS: {
    fetch: assetFetch,
  },
  RAVENOS_CUSTOMER_TRADE_UI_ENABLE: "1",
  RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE: "1",
  RAVENOS_CUSTOMER_TRADE_SOLANA_ENABLE: "1",
  RAVENOS_CUSTOMER_TRADE_FIXTURE_MODE: "1",
};

const server = createServer(async (req, res) => {
  try {
    const request = new Request(`http://127.0.0.1:${port}${req.url || "/"}`, {
      method: req.method,
      headers: req.headers,
      body: req.method && !["GET", "HEAD"].includes(req.method) ? req : undefined,
      duplex: req.method && !["GET", "HEAD"].includes(req.method) ? "half" : undefined,
    });
    const response = await worker.fetch(request, env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) {
      res.end();
      return;
    }
    const stream = response.body.getReader();
    async function pump() {
      while (true) {
        const { done, value } = await stream.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    }
    await pump();
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "playwright_server_failure", message: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RavenOS Playwright terminal server listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
