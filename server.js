const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const CONFIG = path.join(ROOT, "data", "config.json");
const ADMIN = path.join(ROOT, "data", "admin.json");
const SESSIONS = path.join(ROOT, "data", "sessions.json");
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const sessions = new Set();

function loadSessions() {
  try {
    const list = JSON.parse(fs.readFileSync(SESSIONS, "utf8"));
    if (Array.isArray(list)) {
      for (const token of list) sessions.add(String(token));
    }
  } catch {
    /* first run */
  }
}

function saveSessions() {
  const list = [...sessions].slice(-30);
  fs.writeFileSync(SESSIONS, JSON.stringify(list));
}

function ensureAdmin() {
  if (!fs.existsSync(ADMIN)) {
    fs.mkdirSync(path.dirname(ADMIN), { recursive: true });
    fs.writeFileSync(ADMIN, JSON.stringify({ password: "161161" }, null, 2));
  }
}

function readPassword() {
  ensureAdmin();
  const data = JSON.parse(fs.readFileSync(ADMIN, "utf8"));
  return String(data.password || "");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Слишком большой запрос"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Неверный JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    "Content-Length": payload.length,
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, data, extraHeaders = {}) {
  send(res, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
}

function cookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function isAuthed(req) {
  const token = cookies(req).s161;
  return Boolean(token && sessions.has(token));
}

function assertConfig(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Файл конфигурации должен быть объектом");
  }
  if (typeof data.codeWord !== "string" || !data.codeWord.trim()) {
    throw new Error("Укажите кодовое слово");
  }
  if (!Array.isArray(data.categories) || data.categories.length === 0) {
    throw new Error("Нужна хотя бы одна категория");
  }
  if (!Array.isArray(data.points)) throw new Error("Нет списка точек");
  if (!data.office || !Array.isArray(data.office.items)) throw new Error("Нет цен офиса");
  if (!Array.isArray(data.rules)) throw new Error("Нет правил");
  const cats = new Set();
  for (const category of data.categories) {
    if (!category.id || !category.title) throw new Error("У категории нет названия");
    if (cats.has(category.id)) throw new Error("Повтор категории: " + category.id);
    cats.add(category.id);
    if (category.color && !/^#[0-9a-fA-F]{6}$/.test(category.color)) {
      throw new Error("Цвет категории " + category.title + " должен быть #RRGGBB");
    }
  }
  const ids = new Set();
  for (const point of data.points) {
    if (!point.id || !point.name) throw new Error("У точки нет названия");
    if (ids.has(point.id)) throw new Error("Повтор точки: " + point.name);
    ids.add(point.id);
    if (!Array.isArray(point.categories) || point.categories.length === 0) {
      throw new Error("Выберите категорию: " + point.name);
    }
    for (const categoryId of point.categories) {
      if (!cats.has(categoryId)) throw new Error("Неизвестная категория у " + point.name);
    }
    for (const key of ["lat", "lng"]) {
      if (point[key] == null || point[key] === "") continue;
      if (typeof point[key] !== "number" || !Number.isFinite(point[key])) {
        throw new Error("Координаты должны быть числами: " + point.name);
      }
    }
    if (point.lat != null && (point.lat < -90 || point.lat > 90)) {
      throw new Error("Широта вне диапазона: " + point.name);
    }
    if (point.lng != null && (point.lng < -180 || point.lng > 180)) {
      throw new Error("Долгота вне диапазона: " + point.name);
    }
  }
  for (const item of data.office.items) {
    if (!item.name || !String(item.name).trim()) throw new Error("Пустое название в ценах офиса");
    if (typeof item.price !== "number" || !Number.isFinite(item.price) || item.price < 0) {
      throw new Error("Цена должна быть числом: " + item.name);
    }
  }
}

function atomicWrite(file, text) {
  const tmp = file + ".tmp";
  const bak = file + ".bak";
  fs.writeFileSync(tmp, text);
  if (fs.existsSync(bak)) fs.unlinkSync(bak);
  if (fs.existsSync(file)) fs.renameSync(file, bak);
  fs.renameSync(tmp, file);
}

function lanAddresses() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) urls.push(`http://${net.address}:${PORT}`);
    }
  }
  return urls;
}

function safeFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const rel = path.normalize(decoded).replace(/^([/\\])+/, "");
  const full = path.resolve(PUBLIC, rel);
  if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) return null;
  return full;
}

function serveFile(res, file) {
  fs.readFile(file, (error, data) => {
    if (error) {
      send(res, 404, "Не найдено", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const cache = "no-cache";
    send(res, 200, data, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": cache,
    });
  });
}

async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ru&q=" +
    encodeURIComponent(query);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "service161-local/1.0 (staff directory)",
      "Accept-Language": "ru",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Геокодер ответил " + response.status);
  const data = await response.json();
  return data.map((item) => ({
    lat: Number(item.lat),
    lng: Number(item.lon),
    label: item.display_name,
  }));
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    const raw = fs.readFileSync(CONFIG, "utf8");
    JSON.parse(raw);
    send(res, 200, raw, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/info") {
    sendJson(res, 200, { port: PORT, local: `http://localhost:${PORT}`, lan: lanAddresses() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    sendJson(res, 200, { ok: isAuthed(req) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    if (!safeEqual(body.password || "", readPassword())) {
      sendJson(res, 401, { error: "Неверный пароль" });
      return;
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    saveSessions();
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": `s161=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = cookies(req).s161;
    if (token) sessions.delete(token);
    saveSessions();
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "s161=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
    return;
  }

  if (!isAuthed(req) && ["/api/config", "/api/password", "/api/geocode"].some((pathName) => url.pathname === pathName)) {
    sendJson(res, 401, { error: "Нужно войти" });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/config") {
    const body = await readBody(req);
    try {
      assertConfig(body);
    } catch (error) {
      error.status = 400;
      throw error;
    }
    body.updatedAt = new Date().toISOString();
    atomicWrite(CONFIG, JSON.stringify(body, null, 2) + "\n");
    sendJson(res, 200, { ok: true, updatedAt: body.updatedAt });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/password") {
    const body = await readBody(req);
    const next = String(body.password || "");
    if (next.length < 4) {
      sendJson(res, 400, { error: "Пароль короче 4 символов" });
      return;
    }
    atomicWrite(ADMIN, JSON.stringify({ password: next }, null, 2) + "\n");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/geocode") {
    const query = (url.searchParams.get("q") || "").trim();
    if (query.length < 3) {
      sendJson(res, 400, { error: "Слишком короткий адрес" });
      return;
    }
    const hits = await geocode(query);
    sendJson(res, 200, { hits });
    return;
  }

  sendJson(res, 404, { error: "Нет такого запроса" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => {
      if (res.headersSent) return;
      const status = error.status || 500;
      sendJson(res, status, { error: error.message || "Ошибка сервера" });
    });
    return;
  }

  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/admin") pathname = "/admin.html";
  const file = safeFile(pathname);
  if (!file) {
    send(res, 400, "Плохой путь", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      send(res, 404, "Не найдено", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    serveFile(res, file);
  });
});

loadSessions();
ensureAdmin();
if (!fs.existsSync(CONFIG)) {
  console.error("Missing data/config.json");
  process.exit(1);
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Service 161  http://localhost:${PORT}`);
  console.log(`Admin        http://localhost:${PORT}/admin`);
  for (const item of lanAddresses()) console.log(`Phone        ${item}`);
});
