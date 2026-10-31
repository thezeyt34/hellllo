// Сервер: отдаёт сайт, пишет поиски в SQLite и показывает статистику в админке.
// Запуск: node server.js   (нужен Node.js 22.13 или новее, больше ничего ставить не надо)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (e) {
  console.error("Нужен Node.js 22.13 или новее (там встроен SQLite). Обновить: https://nodejs.org");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
// Логин и пароль админки (можно задать через переменные окружения ADMIN_LOGIN и ADMIN_PASSWORD)
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "azams";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "azams123";

// На Render пароль по умолчанию не разрешён: его нужно задать в настройках
if (process.env.RENDER && !process.env.ADMIN_PASSWORD) {
  console.error("Задай ADMIN_PASSWORD (и ADMIN_LOGIN) в настройках Environment на Render.");
  process.exit(1);
}

// ---------- База данных ----------
// Путь к файлу базы. На Render это папка постоянного диска, например /var/data/data.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip TEXT,
    device TEXT,
    os TEXT,
    browser TEXT,
    user_agent TEXT,
    screen TEXT,
    language TEXT,
    visitor_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_searches_name ON searches(name);
`);
const insertSearch = db.prepare(
  `INSERT INTO searches (name, created_at, ip, device, os, browser, user_agent, screen, language, visitor_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

// ---------- Вспомогательные функции ----------
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/script.js": ["script.js", "text/javascript; charset=utf-8"],
  "/admin": ["admin.html", "text/html; charset=utf-8"],
  "/admin.css": ["admin.css", "text/css; charset=utf-8"],
  "/admin.js": ["admin.js", "text/javascript; charset=utf-8"]
};

function parseUA(ua) {
  ua = ua || "";
  let device = "Компьютер";
  if (/iPad|Tablet/i.test(ua)) device = "Планшет";
  else if (/Mobi|iPhone|Android/i.test(ua)) device = "Телефон";

  let os = "Другая";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Другой";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/YaBrowser/i.test(ua)) browser = "Yandex";
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS/i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";
  return { device, os, browser };
}

function getIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  let ip = fwd ? String(fwd).split(",")[0].trim() : req.socket.remoteAddress || "";
  return ip.replace(/^::ffff:/, "");
}

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too big")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(data));
}

function clean(value, max, pattern) {
  let s = typeof value === "string" ? value.slice(0, max) : "";
  if (pattern && !pattern.test(s)) s = "";
  return s;
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Простой ограничитель частоты запросов (в памяти)
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
      hits.set(key, arr);
      return arr.length < max;
    },
    add(key) {
      const arr = hits.get(key) || [];
      arr.push(Date.now());
      hits.set(key, arr);
    }
  };
}
const searchLimiter = makeLimiter(30, 60 * 1000);          // 30 поисков в минуту с одного IP
const loginLimiter = makeLimiter(5, 10 * 60 * 1000);       // 5 неудачных входов за 10 минут

// ---------- Сессии админки ----------
const sessions = new Map(); // token -> время окончания
const SESSION_MS = 12 * 60 * 60 * 1000;

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

function isAdmin(req) {
  const token = getCookie(req, "sid");
  const exp = sessions.get(token);
  if (!token || !exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function isHttps(req) {
  return req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
}

// ---------- Обработка запросов ----------
async function handleApi(req, res, url) {
  const ip = getIp(req);

  // Запись поиска имени
  if (req.method === "POST" && url.pathname === "/api/search") {
    if (!searchLimiter.check(ip)) return sendJson(res, 429, { error: "too many requests" });
    searchLimiter.add(ip);
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: "bad request" }); }
    const name = clean(body.name, 40, /^[a-z]+$/);
    if (!name) return sendJson(res, 400, { error: "bad name" });
    const ua = String(req.headers["user-agent"] || "").slice(0, 300);
    const info = parseUA(ua);
    insertSearch.run(
      name,
      new Date().toISOString(),
      ip,
      info.device,
      info.os,
      info.browser,
      ua,
      clean(body.screen, 20, /^\d{2,5}x\d{2,5}$/),
      clean(body.language, 20, /^[A-Za-z0-9-_]+$/),
      clean(body.visitorId, 64, /^[A-Za-z0-9-_]+$/)
    );
    res.writeHead(204);
    return res.end();
  }

  // Вход в админку
  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    if (!loginLimiter.check(ip)) return sendJson(res, 429, { error: "Слишком много попыток, подожди 10 минут" });
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: "bad request" }); }
    const okLogin = safeEqual(body.login || "", ADMIN_LOGIN);
    const okPass = safeEqual(body.password || "", ADMIN_PASSWORD);
    if (!(okLogin && okPass)) {
      loginLimiter.add(ip);
      return sendJson(res, 401, { error: "Неверный логин или пароль" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_MS);
    res.setHeader(
      "Set-Cookie",
      `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` + (isHttps(req) ? "; Secure" : "")
    );
    return sendJson(res, 200, { ok: true });
  }

  // Выход
  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    sessions.delete(getCookie(req, "sid"));
    res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return sendJson(res, 200, { ok: true });
  }

  // Статистика (только для админа)
  if (req.method === "GET" && url.pathname === "/api/admin/stats") {
    if (!isAdmin(req)) return sendJson(res, 401, { error: "unauthorized" });
    const total = db.prepare("SELECT COUNT(*) AS c FROM searches").get().c;
    const visitors = db
      .prepare("SELECT COUNT(DISTINCT CASE WHEN visitor_id != '' THEN visitor_id ELSE ip END) AS c FROM searches")
      .get().c;
    const byName = db
      .prepare(
        `SELECT name, COUNT(*) AS count,
                COUNT(DISTINCT CASE WHEN visitor_id != '' THEN visitor_id ELSE ip END) AS uniques,
                MAX(created_at) AS last
         FROM searches GROUP BY name ORDER BY count DESC, name ASC`
      )
      .all();
    const recent = db
      .prepare(
        `SELECT name, created_at, ip, device, os, browser, screen, language, visitor_id
         FROM searches ORDER BY id DESC LIMIT 500`
      )
      .all();
    return sendJson(res, 200, { total, visitors, byName, recent });
  }

  return sendJson(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let pathname = url.pathname;
    if (pathname === "/admin/") pathname = "/admin";
    url.pathname = pathname;

    if (pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }

    if (pathname.startsWith("/api/")) return await handleApi(req, res, url);

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end();
    }

    const entry = STATIC[pathname];
    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404");
    }
    const file = path.join(__dirname, entry[0]);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Файл не найден: " + entry[0]);
      }
      res.writeHead(200, {
        "Content-Type": entry[1],
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache"
      });
      res.end(data);
    });
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`База:    ${DB_PATH}`);
  console.log(`Сайт:    http://localhost:${PORT}`);
  console.log(`Админка: http://localhost:${PORT}/admin`);
});
