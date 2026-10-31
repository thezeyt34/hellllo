const $ = (id) => document.getElementById(id);
const loginBox = $("login");
const panel = $("panel");
let data = null;
let filterName = "";
let timer = null;

function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("ru-RU");
}

function cell(tr, text, label) {
  const td = document.createElement("td");
  if (label) td.setAttribute("data-label", label);
  td.textContent = text == null || text === "" ? "-" : String(text);
  tr.appendChild(td);
}

function render() {
  if (!data) return;
  $("totalNum").textContent = data.total;
  $("visitorsNum").textContent = data.visitors;
  $("namesNum").textContent = data.byName.length;

  const nb = $("namesBody");
  nb.textContent = "";
  for (const row of data.byName) {
    const tr = document.createElement("tr");
    tr.className = "clickable";
    cell(tr, row.name, "Имя");
    cell(tr, row.count, "Поисков");
    cell(tr, row.uniques, "Устройств");
    cell(tr, fmtTime(row.last), "Последний раз");
    tr.addEventListener("click", () => { filterName = row.name; render(); });
    nb.appendChild(tr);
  }

  const rb = $("recentBody");
  rb.textContent = "";
  const rows = filterName ? data.recent.filter((r) => r.name === filterName) : data.recent;
  for (const r of rows) {
    const tr = document.createElement("tr");
    cell(tr, fmtTime(r.created_at), "Время");
    cell(tr, r.name, "Имя");
    cell(tr, r.device, "Устройство");
    cell(tr, r.os, "Система");
    cell(tr, r.browser, "Браузер");
    cell(tr, r.ip, "IP");
    cell(tr, r.screen, "Экран");
    cell(tr, r.visitor_id ? r.visitor_id.slice(0, 8) : "", "ID");
    rb.appendChild(tr);
  }
  $("recentTitle").textContent = filterName ? `Запросы по имени: ${filterName}` : "Последние запросы";
  $("resetFilter").classList.toggle("hidden", !filterName);
}

async function loadStats() {
  const res = await fetch("/api/admin/stats", { cache: "no-store" });
  if (res.status === 401) { showLogin(); return false; }
  data = await res.json();
  showPanel();
  render();
  return true;
}

function showLogin() {
  clearInterval(timer);
  panel.classList.add("hidden");
  loginBox.classList.remove("hidden");
}

function showPanel() {
  loginBox.classList.add("hidden");
  panel.classList.remove("hidden");
  clearInterval(timer);
  timer = setInterval(loadStats, 15000);
}

async function login() {
  $("loginError").textContent = "";
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: $("loginInput").value, password: $("passInput").value })
  });
  if (res.ok) {
    $("passInput").value = "";
    await loadStats();
  } else {
    const j = await res.json().catch(() => ({}));
    $("loginError").textContent = j.error || "Ошибка входа";
  }
}

$("loginBtn").addEventListener("click", login);
$("passInput").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("refreshBtn").addEventListener("click", loadStats);
$("resetFilter").addEventListener("click", () => { filterName = ""; render(); });
$("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  data = null;
  showLogin();
});

loadStats();
