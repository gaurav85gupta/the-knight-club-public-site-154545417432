/**
 * Static file server for the public-website site (dev + simple production use).
 *
 * WHY THIS EXISTS instead of `npx serve`:
 * Some versions of the `serve` package implement "clean URLs" by 301/302
 * redirecting a request for `/pages/course-form.html?id=X` to
 * `/pages/course-form?id=X` (dropping the extension) — and in doing so can
 * drop the query string during that redirect. Since `course-form.html?id=X`
 * is how this app identifies WHICH course to edit, losing `?id=X` silently
 * sends the admin to a blank "New course" form instead of the course they
 * clicked. This server never redirects: it serves the exact file that was
 * asked for, so the query string is never touched.
 *
 * BEHAVIOUR:
 *   - Serves files directly under this directory (no directory listing).
 *   - `/pages/course-form.html?id=X` -> serves pages/course-form.html as-is.
 *   - `/pages/course-form?id=X` (no extension) -> ALSO serves
 *     pages/course-form.html, by trying `<path>.html` as a fallback. This
 *     keeps both forms of the URL working without ever issuing a redirect.
 *   - Unknown paths -> 404.
 *   - Query strings are never inspected or altered — only the path portion
 *     of the URL is used to resolve a file.
 *
 * USAGE:
 *   node serve-static.js [port]        (default port 3000)
 */

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------------------
// API proxy — forwards /api/* requests to the backend so the browser never
// hits localhost:3000/api (frontend) when it should hit localhost:5000/api.
// Without this, any fetch() that falls back to a relative URL (or any
// misconfiguration in config.js) silently hits the static server and gets a
// 404 instead of a real backend response.
//
// The backend port can be overridden: API_PORT=4000 node serve-static.js
// ---------------------------------------------------------------------------
const API_BACKEND_PORT = Number(process.env.API_PORT) || 5000;
const API_BACKEND_HOST = process.env.API_HOST || 'localhost';

function proxyApiRequest(req, res) {
  const options = {
    hostname: API_BACKEND_HOST,
    port: API_BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: API_BACKEND_HOST + ':' + API_BACKEND_PORT,
    },
  };

  const proxyReq = http.request(options, function (proxyRes) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', function (err) {
    console.error('[proxy] Backend unreachable:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: false,
      message: 'Backend server is not running on port ' + API_BACKEND_PORT + '. Start it with: npm run dev (in the backend folder).',
      errorCode: 'BACKEND_UNAVAILABLE',
    }));
  });

  req.pipe(proxyReq, { end: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

// Resolve a URL path to a real file on disk, WITHOUT ever redirecting.
// Tries, in order: the exact path, then the exact path + ".html",
// then (if the path ends in "/") that path + "index.html".
function resolveFile(urlPath) {
  // Decode and strip any ".." traversal attempts; normalize separators.
  const decoded = decodeURIComponent(urlPath);
  const safeRelative = path
    .normalize(decoded)
    .replace(/^([/\\])+/, '') // no leading slash
    .split(/[/\\]/)
    .filter((seg) => seg !== '..' && seg !== '.')
    .join(path.sep);

  const candidates = [];
  const base = path.join(ROOT, safeRelative);

  if (safeRelative === '' || decoded.endsWith('/')) {
    candidates.push(path.join(base, 'index.html'));
  } else {
    candidates.push(base); // exact file, e.g. pages/course-form.html
    candidates.push(`${base}.html`); // extension-less request, e.g. pages/course-form
  }

  for (const candidate of candidates) {
    // Guard: resolved path must stay inside ROOT.
    if (!candidate.startsWith(ROOT)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  // Forward all /api/* requests to the backend — never try to serve them as files.
  if ((req.url || '').startsWith('/api/')) {
    return proxyApiRequest(req, res);
  }

  const urlPath = (req.url || '/').split('?')[0].split('#')[0];
  const filePath = resolveFile(urlPath);

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 Internal Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      // Dev-friendly: don't let the browser cache JS/HTML while iterating.
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Public website serving at http://localhost:${PORT}`);
  console.log(`Serving files from:  ${ROOT}`);
  console.log(`API proxy:           /api/* → http://${API_BACKEND_HOST}:${API_BACKEND_PORT}`);
  console.log(`Override backend:    API_PORT=<port> node serve-static.js`);
});