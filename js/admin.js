let config = null;
let editingId = null;
let editMap = null;
let editMarker = null;

const $ = (id) => document.getElementById(id);

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

async function loadSiteConfig() {
  for (const url of ["api/config", "config.json"]) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const data = await response.json();
      if (data && Array.isArray(data.points)) return data;
    } catch {
      /* local file or the save address is not there yet */
    }
  }
  if (window.__CONFIG__ && Array.isArray(window.__CONFIG__.points)) {
    return JSON.parse(JSON.stringify(window.__CONFIG__));
  }
  throw new Error("Справочник не открылся");
}

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function normalizePhone(input) {
  let value = String(input || "").replace(/\D/g, "");
  if (value.length === 11 && value.startsWith("8")) value = "7" + value.slice(1);
  if (value.length === 10) value = "7" + value;
  if (value.length < 11) return "";
  return "+" + value;
}

function captureForms() {
  if ($("office-title")) {
    config.office.title = $("office-title").value.trim();
    config.office.note = $("office-note").value.trim();
    config.office.items = [...document.querySelectorAll("[data-price]")].map((row) => ({
      id: row.dataset.price,
      name: row.querySelector("[data-name]").value.trim(),
      price: Number(row.querySelector("[data-price-value]").value),
    }));
  }
  if ($("text-code")) {
    config.codeWord = $("text-code").value.trim();
    config.city = $("text-city").value.trim();
    config.listBanner = $("text-banner").value.trim();
    config.rules = [...document.querySelectorAll("[data-rule]")].map((row) => ({
      title: row.querySelector("[data-title]").value.trim(),
      text: row.querySelector("[data-text]").value.trim(),
    }));
    config.categories = [...document.querySelectorAll("[data-cat-row]")].map((row) => ({
      id: row.dataset.catRow,
      title: row.querySelector("[data-title]").value.trim(),
      short: row.querySelector("[data-short]").value.trim(),
      color: row.querySelector("[data-color]").value,
      blurb: row.querySelector("[data-blurb]").value.trim(),
    }));
  }
}

async function persist() {
  captureForms();
  const payload = JSON.parse(JSON.stringify(config));
  payload.office.items = payload.office.items.filter((item) => item.name);
  payload.rules = payload.rules.filter((rule) => rule.title || rule.text);
  payload.categories = payload.categories.filter((category) => category.title && category.id);
  config = payload;
  const response = await fetch("api/config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": sessionStorage.getItem("s161-pass") || "",
    },
    body: JSON.stringify(config),
  });
  if (response.status === 401) {
    sessionStorage.removeItem("s161");
    sessionStorage.removeItem("s161-pass");
    location.reload();
    return;
  }
  if (!response.ok) throw new Error("Не удалось записать");
  if ($("office-title")) renderOffice();
  if ($("text-code")) renderTexts();
  toast("Записано");
}

function renderPoints() {
  const rows = config.points.map((point, index) => {
    const names = point.categories.map((id) => (config.categories.find((category) => category.id === id) || {}).short || id).join(", ");
    return `<article class="point-row">
      <div><b>${S161.esc(point.name)}</b><span>${S161.esc(point.address || "без адреса")} · ${S161.esc(names)}</span></div>
      <div class="icon-btns">
        <button type="button" class="btn" data-up="${index}" aria-label="Выше">↑</button>
        <button type="button" class="btn" data-down="${index}" aria-label="Ниже">↓</button>
        <button type="button" class="btn" data-edit="${S161.esc(point.id)}">Править</button>
      </div>
    </article>`;
  }).join("");
  $("tab-points").innerHTML = `<div class="section-head"><h2>Точки</h2><button type="button" class="btn primary" id="add-point">Новая точка</button></div>${rows || "<p class='muted'>Пока пусто</p>"}`;
}

function renderOffice() {
  const rows = (config.office.items || []).map((item, index) => `<div class="point-row" data-price="${S161.esc(item.id)}">
      <input class="bare" data-name value="${S161.esc(item.name)}">
      <input class="bare" data-price-value type="number" min="0" step="1" value="${Number(item.price)}">
      <div class="icon-btns">
        <button type="button" class="btn" data-pup="${index}">↑</button>
        <button type="button" class="btn" data-pdown="${index}">↓</button>
        <button type="button" class="btn" data-pdel="${index}">×</button>
      </div>
    </div>`).join("");
  $("tab-office").innerHTML = `<div class="edit-grid">
      <label>Заголовок<input id="office-title" class="bare" value="${S161.esc(config.office.title || "")}"></label>
      <label>Пояснение<textarea id="office-note" class="bare" rows="3">${S161.esc(config.office.note || "")}</textarea></label>
      <div id="price-rows">${rows}</div>
      <div class="route-row">
        <button type="button" class="btn" id="add-price">Добавить цену</button>
        <button type="button" class="btn primary" id="save-office">Записать</button>
      </div>
    </div>`;
}

function renderTexts() {
  const rules = (config.rules || []).map((rule, index) => `<div class="contact-edit" data-rule>
      <input data-title placeholder="Заголовок" value="${S161.esc(rule.title || "")}">
      <textarea data-text rows="2" placeholder="Текст">${S161.esc(rule.text || "")}</textarea>
      <button type="button" class="btn" data-rdel="${index}">Убрать правило</button>
    </div>`).join("");
  const cats = config.categories.map((category) => `<div class="contact-edit" data-cat-row="${S161.esc(category.id)}">
      <input data-title placeholder="Название" value="${S161.esc(category.title)}">
      <input data-short placeholder="Коротко для фильтра" value="${S161.esc(category.short || "")}">
      <input data-color type="color" value="${S161.safeColor(category.color)}">
      <textarea data-blurb rows="2" placeholder="Пояснение фильтра">${S161.esc(category.blurb || "")}</textarea>
      <button type="button" class="btn" data-cdel="${S161.esc(category.id)}">Убрать категорию</button>
    </div>`).join("");
  $("tab-texts").innerHTML = `<div class="edit-grid">
      <label>Кодовое слово<input id="text-code" class="bare" value="${S161.esc(config.codeWord || "")}"></label>
      <label>Город по умолчанию<input id="text-city" class="bare" value="${S161.esc(config.city || "")}"></label>
      <label>Строка над списком<textarea id="text-banner" class="bare" rows="2">${S161.esc(config.listBanner || "")}</textarea></label>
      <h3>Правила</h3>
      <div id="rule-rows">${rules}</div>
      <button type="button" class="btn" id="add-rule">Добавить правило</button>
      <h3>Категории</h3>
      <div id="cat-rows">${cats}</div>
      <button type="button" class="btn" id="add-cat">Добавить категорию</button>
      <button type="button" class="btn primary" id="save-texts">Записать</button>
    </div>`;
}

function contactRow(contact = {}) {
  const row = document.createElement("div");
  row.className = "contact-edit";
  row.innerHTML = `<input data-cname placeholder="Имя" value="${S161.esc(contact.name || "")}">
    <input data-cphone placeholder="Телефон" value="${S161.esc(contact.phone || "")}">
    <input data-cnote placeholder="Заметка" value="${S161.esc(contact.note || "")}">
    <select data-cprefer>
      <option value="any">Звонок и WhatsApp</option>
      <option value="call">Только звонок</option>
      <option value="wa">Сначала WhatsApp</option>
      <option value="wa-only">Только WhatsApp</option>
    </select>
    <button type="button" class="btn" data-cremove>Убрать телефон</button>`;
  row.querySelector("[data-cprefer]").value = contact.prefer || "any";
  return row;
}

function ensureEditMap() {
  if (!editMap) {
    editMap = L.map("edit-map").setView([47.235, 39.72], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(editMap);
    editMap.on("click", (event) => {
      $("f-lat").value = event.latlng.lat.toFixed(6);
      $("f-lng").value = event.latlng.lng.toFixed(6);
      $("f-precision").value = "house";
      placeEditMarker(false);
    });
  }
  setTimeout(() => {
    editMap.invalidateSize();
    placeEditMarker(true);
  }, 80);
}

function placeEditMarker(recenter) {
  if (!editMap) return;
  const lat = Number($("f-lat").value);
  const lng = Number($("f-lng").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (editMarker) {
      editMarker.remove();
      editMarker = null;
    }
    return;
  }
  if (!editMarker) editMarker = L.marker([lat, lng]).addTo(editMap);
  else editMarker.setLatLng([lat, lng]);
  if (recenter) editMap.setView([lat, lng], 16);
}

function openEditor(point) {
  editingId = point ? point.id : null;
  $("editor-title").textContent = point ? "Править точку" : "Новая точка";
  $("delete-point").classList.toggle("hidden", !point);
  $("f-name").value = point ? point.name : "";
  $("f-card").value = point ? point.cardNote || "" : "";
  $("f-partner").checked = Boolean(point && point.partner);
  $("f-ahead").checked = Boolean(point && point.callAhead);
  $("f-address").value = point ? point.address || "" : "";
  $("f-locality").value = point ? point.locality || "" : config.city || "";
  $("f-lat").value = point && point.lat != null ? point.lat : "";
  $("f-lng").value = point && point.lng != null ? point.lng : "";
  $("f-precision").value = point ? point.precision || "none" : "none";
  $("f-hours").value = point ? (point.hours || []).join("\n") : "";
  $("f-hours-note").value = point ? point.hoursNote || "" : "";
  $("f-notes").value = point ? point.notes || "" : "";
  $("f-hits").innerHTML = "";
  $("editor-error").textContent = "";
  $("f-cats").innerHTML = config.categories.map((category) => `<label><input type="checkbox" value="${S161.esc(category.id)}" ${point && point.categories.includes(category.id) ? "checked" : ""}> ${S161.esc(category.short || category.title)}</label>`).join("");
  const box = $("f-contacts");
  box.innerHTML = "";
  const contacts = point && point.contacts && point.contacts.length ? point.contacts : [{}];
  contacts.forEach((contact) => box.appendChild(contactRow(contact)));
  $("editor").showModal();
  ensureEditMap();
}

function readPoint() {
  const categories = [...$("f-cats").querySelectorAll("input:checked")].map((input) => input.value);
  let lat = $("f-lat").value.trim() === "" ? null : Number($("f-lat").value);
  let lng = $("f-lng").value.trim() === "" ? null : Number($("f-lng").value);
  let precision = $("f-precision").value;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    lat = null;
    lng = null;
    precision = "none";
  }
  const contacts = [...$("f-contacts").querySelectorAll(".contact-edit")].map((row) => ({
    name: row.querySelector("[data-cname]").value.trim(),
    phone: normalizePhone(row.querySelector("[data-cphone]").value),
    note: row.querySelector("[data-cnote]").value.trim(),
    prefer: row.querySelector("[data-cprefer]").value,
  })).filter((contact) => contact.phone || contact.name);
  if (contacts.some((contact) => !contact.phone)) {
    throw new Error("В одном из телефонов не разобрать номер");
  }
  return {
    id: editingId || uid("p-"),
    categories,
    name: $("f-name").value.trim(),
    partner: $("f-partner").checked,
    callAhead: $("f-ahead").checked,
    address: $("f-address").value.trim(),
    locality: $("f-locality").value.trim(),
    lat,
    lng,
    precision,
    hours: $("f-hours").value.split("\n").map((line) => line.trim()).filter(Boolean),
    hoursNote: $("f-hours-note").value.trim(),
    cardNote: $("f-card").value.trim(),
    notes: $("f-notes").value.trim(),
    contacts,
  };
}

async function savePoint() {
  const point = readPoint();
  if (!point.name) throw new Error("Нужно название");
  if (!point.categories.length) throw new Error("Выберите категорию");
  const index = config.points.findIndex((item) => item.id === point.id);
  if (index === -1) config.points.push(point);
  else config.points[index] = point;
  await persist();
  $("editor").close();
  renderPoints();
}

document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    captureForms();
    document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("is-on", button === tab));
    ["points", "office", "texts", "pass"].forEach((id) => {
      $("tab-" + id).classList.toggle("hidden", id !== tab.dataset.tab);
    });
    return;
  }
  if (event.target.id === "add-point") openEditor(null);
  const edit = event.target.closest("[data-edit]");
  if (edit) openEditor(config.points.find((point) => point.id === edit.dataset.edit));
  const up = event.target.closest("[data-up]");
  const down = event.target.closest("[data-down]");
  if (up || down) {
    const index = Number((up || down).dataset.up || (up || down).dataset.down);
    const next = up ? index - 1 : index + 1;
    if (next >= 0 && next < config.points.length) {
      const [item] = config.points.splice(index, 1);
      config.points.splice(next, 0, item);
      try {
        await persist();
        renderPoints();
      } catch (error) {
        toast(error.message);
      }
    }
  }
  if (event.target.id === "add-price") {
    captureForms();
    config.office.items.push({ id: uid("price-"), name: "", price: 0 });
    renderOffice();
  }
  const pup = event.target.closest("[data-pup]");
  const pdown = event.target.closest("[data-pdown]");
  const pdel = event.target.closest("[data-pdel]");
  if (pup || pdown || pdel) {
    captureForms();
    const index = Number((pup || pdown || pdel).dataset.pup || (pup || pdown || pdel).dataset.pdown || (pup || pdown || pdel).dataset.pdel);
    if (pdel) config.office.items.splice(index, 1);
    else {
      const next = pup ? index - 1 : index + 1;
      if (next < 0 || next >= config.office.items.length) return;
      const [item] = config.office.items.splice(index, 1);
      config.office.items.splice(next, 0, item);
    }
    renderOffice();
  }
  if (event.target.id === "add-rule") {
    captureForms();
    config.rules.push({ title: "", text: "" });
    renderTexts();
  }
  const rdel = event.target.closest("[data-rdel]");
  if (rdel) {
    captureForms();
    config.rules.splice(Number(rdel.dataset.rdel), 1);
    renderTexts();
  }
  if (event.target.id === "add-cat") {
    captureForms();
    config.categories.push({ id: uid("cat-"), title: "Новая", short: "Новая", color: "#1d4e89", blurb: "" });
    renderTexts();
  }
  const cdel = event.target.closest("[data-cdel]");
  if (cdel) {
    captureForms();
    const used = config.points.some((point) => point.categories.includes(cdel.dataset.cdel));
    if (used) {
      toast("Категория используется в точках");
      return;
    }
    config.categories = config.categories.filter((category) => category.id !== cdel.dataset.cdel);
    renderTexts();
  }
  if (event.target.closest("[data-cremove]")) event.target.closest(".contact-edit").remove();
});

$("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  const password = $("password").value;
  let accepted = false;
  try {
    const response = await fetch("api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.status === 401) {
      $("login-error").textContent = "Неверный пароль";
      return;
    }
    accepted = response.ok;
  } catch {
    accepted = false;
  }
  if (!accepted) {
    const expected = (config && config.adminPassword) || "161161";
    if (password !== expected) {
      $("login-error").textContent = "Неверный пароль";
      return;
    }
  }
  sessionStorage.setItem("s161", "1");
  sessionStorage.setItem("s161-pass", password);
  openPanel();
});

$("logout").addEventListener("click", () => {
  sessionStorage.removeItem("s161");
  sessionStorage.removeItem("s161-pass");
  location.reload();
});

$("save-pass").addEventListener("click", async () => {
  $("pass-error").textContent = "";
  const next = $("new-password").value;
  if (next.length < 4) {
    $("pass-error").textContent = "Пароль короче 4 символов";
    return;
  }
  config.adminPassword = next;
  $("new-password").value = "";
  try {
    await persist();
    sessionStorage.setItem("s161-pass", next);
  } catch (error) {
    $("pass-error").textContent = error.message;
  }
});

$("editor-close").addEventListener("click", () => $("editor").close());
$("add-contact").addEventListener("click", () => $("f-contacts").appendChild(contactRow()));
$("f-clear-coords").addEventListener("click", () => {
  $("f-lat").value = "";
  $("f-lng").value = "";
  $("f-precision").value = "none";
  placeEditMarker(false);
});
$("f-geocode").addEventListener("click", async () => {
  const query = [$("f-address").value.trim(), $("f-locality").value.trim()].filter(Boolean).join(", ");
  $("f-hits").innerHTML = "<span class='muted'>Ищу…</span>";
  try {
    const response = await fetch(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ru&q=" + encodeURIComponent(query),
      { headers: { "Accept-Language": "ru" } }
    );
    if (!response.ok) throw new Error("Адрес не найден. Поставьте точку кликом по карте.");
    const data = {
      hits: (await response.json()).map((item) => ({
        lat: Number(item.lat),
        lng: Number(item.lon),
        label: item.display_name,
      })),
    };
    if (!data.hits.length) {
      $("f-hits").textContent = "Ничего не нашлось. Поставьте точку кликом по карте.";
      return;
    }
    $("f-hits").innerHTML = data.hits.map((hit, index) =>
      `<button type="button" class="btn" data-hit="${index}">${S161.esc(hit.label)}</button>`
    ).join("");
    $("f-hits").querySelectorAll("[data-hit]").forEach((button) => {
      button.addEventListener("click", () => {
        const hit = data.hits[Number(button.dataset.hit)];
        $("f-lat").value = hit.lat;
        $("f-lng").value = hit.lng;
        $("f-precision").value = "house";
        placeEditMarker(true);
      });
    });
  } catch (error) {
    $("f-hits").textContent = error.message;
  }
});
$("save-point").addEventListener("click", async () => {
  $("editor-error").textContent = "";
  try {
    await savePoint();
  } catch (error) {
    $("editor-error").textContent = error.message;
  }
});
$("delete-point").addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("Удалить точку?")) return;
  config.points = config.points.filter((point) => point.id !== editingId);
  try {
    await persist();
    $("editor").close();
    renderPoints();
  } catch (error) {
    $("editor-error").textContent = error.message;
  }
});

document.body.addEventListener("click", async (event) => {
  if (event.target.id === "save-office" || event.target.id === "save-texts") {
    try {
      await persist();
    } catch (error) {
      toast(error.message);
    }
  }
});

function openPanel() {
  $("login").classList.add("hidden");
  $("panel").classList.remove("hidden");
  renderPoints();
  renderOffice();
  renderTexts();
}

async function boot() {
  config = await loadSiteConfig();
  if (sessionStorage.getItem("s161") === "1" && sessionStorage.getItem("s161-pass")) openPanel();
}

boot().catch((error) => {
  $("login-error").textContent = error.message;
});
