// Имя маленькими буквами → текст приветствия
// Чтобы добавить имя: скопируй любую строку, поменяй имя и текст (в конце строки запятая)
const greetings = {
  azam: "Ozim qilgan saytda ozimni ismimni kiritish yaxwimas lekin",
  shahzoda: "shaxoniya_ пошла нахуй, тебе тут не место. выйди нахуй из моего сайта.",
  shaxzoda: "shaxoniya_ пошла нахуй, тебе тут не место. выйди нахуй из моего сайта.",
  shamshod: "Qalesan Shamshod ishlarin yaxwimi, da sani 1 ga 1 Борьба da yutomiman.",
  saidahror: "Said qalesan, esindan chiqmasin sandan tezro yuguraman.",
  elshod: "Elshod qalesan, Saidni shkafga tiqilu? (hazil shkaf ni eshigi singan ku)",
  sarvar: "Sarvar qalesan iwlarin yaxwimi.",
  aziz: "Aziz qalesan yaxwimisan tuzumisan.",
  diyor: "Diyor qalesan hammasi yaxwimi tuzumisan.",
  xamidullo: "Xamidulloja qalesan ishlarin yaxwimi.",
  xamidulloja: "Xamidulloja qalesan ishlarin yaxwimi.",
  sadoqat: "Assalomu Alaykum yaxwimisiz tuzumisiz ishlariz yaxwimi.",
  sadokat: "Assalomu Alaykum yaxwimisiz tuzumisiz ishlariz yaxwimi.",
  shaxnoza: "Assalomu alaykum man tashagan kinolarni korvossizmi?",
  shahnoza: "Assalomu alaykum man tashagan kinolarni korvossizmi?",
  farzona: "idish tovogimni yuvib ber please",
  maryam: "Доброго времени суток как жизнь, дела как.",
  mariyam: "Доброго времени суток как жизнь, дела как.",
  omina: "3 ta Omina ismli qizni taniman qaysi biri?",
  abbos: "Abbos qalesan iwlarin, uydigila yaxwimi.",
  yoqub: "Qalesan jigarim yaxwimisan ishlawin yaxwimi",
  sharifjon: "assalomu alaykum toga yaxwimisiz tuzumisiz uydigila yaxwimi",
  sofia: "София здарова как дела",
  sofiya: "София здарова как дела",
  gleb: "Глеб почему ты всегда улыбаешься?"
};

// Для всех остальных имён
const defaultGreeting = (name) => `${name} qalesan`;

// Тексты интерфейса на двух языках
const i18n = {
  ru: {
    title: "Привет!",
    a: "Введите своё имя ", b: "английскими буквами", c: "",
    placeholder: "Например: Azam",
    ok: "ОК", back: "Назад",
    errEmpty: "Введите имя",
    errLatin: "ИМЯ ПИСАТЬ ТОЛЬКО АНГЛИСКИМИ БУКВАМИ"
  },
  uz: {
    title: "Salom!",
    a: "Ismingizni ", b: "ingliz harflarida", c: " kiriting",
    placeholder: "Masalan: Azam",
    ok: "OK", back: "Orqaga",
    errEmpty: "Ismni kiriting",
    errLatin: "ISMNI FAQAT INGLIZ HARFLARIDA YOZING"
  }
};

const nameInput = document.getElementById("name");
const errorEl = document.getElementById("error");
const screen1 = document.getElementById("screen1");
const screen2 = document.getElementById("screen2");
const resultEl = document.getElementById("result");

// ---------- Язык ----------
let lang = "ru";
try {
  const saved = localStorage.getItem("lang");
  if (saved === "ru" || saved === "uz") lang = saved;
} catch (e) {}

function applyLang(l) {
  lang = l;
  const t = i18n[l];
  document.documentElement.lang = l;
  document.title = t.title.replace("!", "");
  document.getElementById("tTitle").textContent = t.title;
  document.getElementById("tA").textContent = t.a;
  document.getElementById("tB").textContent = t.b;
  document.getElementById("tC").textContent = t.c;
  nameInput.placeholder = t.placeholder;
  document.getElementById("ok").textContent = t.ok;
  document.getElementById("back").textContent = t.back;
  errorEl.textContent = "";
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === l);
  });
  try { localStorage.setItem("lang", l); } catch (e) {}
}

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyLang(btn.dataset.lang));
});

// ---------- Статистика ----------
// Случайный ID устройства (хранится в браузере), чтобы отличать одного человека от другого
function getVisitorId() {
  try {
    let id = localStorage.getItem("visitorId");
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
      localStorage.setItem("visitorId", id);
    }
    return id;
  } catch (e) {
    return "";
  }
}

// Отправляем имя на сервер (если сервера нет, ошибка молча игнорируется)
function logSearch(name) {
  try {
    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        name: name,
        visitorId: getVisitorId(),
        screen: screen.width + "x" + screen.height,
        language: navigator.language || ""
      })
    }).catch(() => {});
  } catch (e) {}
}

// ---------- Основная логика ----------
function show(text) {
  resultEl.textContent = text;
  screen1.classList.add("hidden");
  screen2.classList.remove("hidden");
}

function submitName() {
  const t = i18n[lang];
  const name = nameInput.value.trim().toLowerCase();
  if (!name) { errorEl.textContent = t.errEmpty; return; }
  errorEl.textContent = "";
  if (!/^[a-z]+$/.test(name)) { show(t.errLatin); return; }
  logSearch(name);
  show(Object.prototype.hasOwnProperty.call(greetings, name) ? greetings[name] : defaultGreeting(name));
}

document.getElementById("ok").addEventListener("click", submitName);
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitName(); });
document.getElementById("back").addEventListener("click", () => {
  nameInput.value = "";
  screen2.classList.add("hidden");
  screen1.classList.remove("hidden");
  nameInput.focus();
});

applyLang(lang);
