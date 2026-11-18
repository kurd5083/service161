const state = {
  config: null,
  view: "list",
  cat: "all",
  q: "",
  near: false,
  pos: null,
  accuracy: null,
  posError: "",
  selected: null,
  watchId: null,
};

let map;
let markers = new Map();
let userMarker;
let userCircle;
let detailOpen = false;
let detailSnapshot = "";
let deferredPrompt;

const $ = (id) => document.getElementById(id);
const phoneDevice = /Android|iPhone|iPad/i.test(navigator.userAgent);

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Скопировано");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast("Скопировано");
  }
}

function pointById(id) {
  return state.config.points.find((point) => point.id === id);
}

function catById(id) {
  return state.config.categories.find((category) => category.id === id);
}

function pointColor(point) {
  const category = catById(point.categories[0]);
  return S161.safeColor(category && category.color);
}

function searchedPoints() {
  const query = state.q.trim().toLowerCase();
  const queryDigits = query.replace(/\D/g, "");
  return state.config.points.filter((point) => {
    if (!query) return true;
    const blob = [
      point.name,
      point.address,
      point.locality,
      point.cardNote,
      point.notes,
      point.hoursNote,
      ...(point.hours || []),
      ...(point.contacts || []).flatMap((contact) => [contact.name, contact.phone, contact.note]),
    ].join(" ").toLowerCase();
    if (blob.includes(query)) return true;
    return queryDigits.length >= 3 && blob.replace(/\D/g, "").includes(queryDigits);
  });
}

function visiblePoints() {
  let points = searchedPoints().map((point, index) => ({ ...point, _i: index }));
  if (state.cat !== "all") points = points.filter((point) => point.categories.includes(state.cat));
  if (state.near && state.pos) {
    points.sort((a, b) => {
      const da = S161.distanceKm(state.pos, a);
      const db = S161.distanceKm(state.pos, b);
      if (da == null && db == null) return a._i - b._i;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db || a._i - b._i;
    });
  }
  return points;
}

function contactActions(contact) {
  const mobile = S161.isMobile(contact.phone);
  if (contact.prefer === "wa-only") return mobile ? ["wa"] : ["tel"];
  if (contact.prefer === "wa") return mobile ? ["wa", "tel"] : ["tel"];
  if (contact.prefer === "call") return ["tel"];
  return mobile ? ["tel", "wa"] : ["tel"];
}

function actionLink(kind, contact, primary) {
  const cls = primary ? "btn primary" : "btn";
  if (kind === "wa") {
    return `<a class="${cls}" target="_blank" rel="noopener" href="https://wa.me/${S161.digits(contact.phone)}">WhatsApp</a>`;
  }
  return `<a class="${cls}" href="tel:+${S161.digits(contact.phone)}">Позвонить</a>`;
}

function renderChips() {
  const points = searchedPoints();
  const chips = [{ id: "all", short: "Все", color: "#1c1916" }, ...state.config.categories];
  $("chips").innerHTML = chips.map((chip) => {
    const count = chip.id === "all" ? points.length : points.filter((point) => point.categories.includes(chip.id)).length;
    return `<button type="button" class="chip${state.cat === chip.id ? " is-on" : ""}" data-cat="${S161.esc(chip.id)}">${S161.esc(chip.short || chip.title)} ${count}</button>`;
  }).join("") + `<button type="button" class="mini${state.near ? " is-on" : ""}" id="near">${state.pos ? "Ближе ко мне" : "Узнать, где я"}</button>`;
  const category = catById(state.cat);
  $("blurb").textContent = category ? category.blurb || "" : "";
}

function renderCards() {
  const points = visiblePoints();
  if (!points.length) {
    $("cards").innerHTML = `<div class="empty">Ничего не нашлось. Смените фильтр или запрос.</div>`;
    return;
  }
  $("cards").innerHTML = points.map((point) => {
    const status = S161.statusNow(point.hours);
    const distance = S161.formatDistance(S161.distanceKm(state.pos, point));
    const badges = [
      point.partner ? `<span class="badge partner">Партнёр</span>` : "",
      status.label ? `<span class="badge ${status.state}">${S161.esc(status.label)}</span>` : "",
      point.callAhead ? `<span class="badge warn">Сначала написать</span>` : "",
      point.precision === "street" ? `<span class="badge warn">На карте примерно</span>` : "",
      !S161.hasCoords(point) ? `<span class="badge warn">Нет метки</span>` : "",
    ].join("");
    const contacts = point.contacts || [];
    let call = "";
    if (contacts.length === 1) {
      const kinds = contactActions(contacts[0]);
      call = actionLink(kinds[0], contacts[0], false).replace("btn", "");
    } else if (contacts.length > 1) {
      call = `<button type="button" data-open="${S161.esc(point.id)}">Номера · ${contacts.length}</button>`;
    }
    const route = S161.canNavigate(point)
      ? `<a class="primary" target="_blank" rel="noopener" href="${S161.esc(S161.routeLinks(point).yandex)}">Маршрут</a>`
      : "";
    return `<article class="card" data-id="${S161.esc(point.id)}">
      <div class="card-top">
        <h2><span class="badge" style="background:${pointColor(point)};color:#fff">${S161.esc((catById(point.categories[0]) || {}).short || "")}</span> ${S161.esc(point.name)}</h2>
        ${distance ? `<div class="dist">${distance}</div>` : ""}
      </div>
      <p>${S161.esc(point.address || "Адрес не указан")}${point.locality ? " · " + S161.esc(point.locality) : ""}</p>
      ${point.cardNote ? `<p>${S161.esc(point.cardNote)}</p>` : ""}
      <div class="meta">${badges}</div>
      <div class="card-actions">${call}${route}</div>
    </article>`;
  }).join("");
}

function renderOffice() {
  const office = state.config.office || { items: [] };
  $("office-title").textContent = office.title || "Офис";
  $("office-note").textContent = [office.note, state.config.listBanner].filter(Boolean).join(" ");
  $("prices").innerHTML = office.items
    .map((item) => `<div class="price-row"><span>${S161.esc(item.name)}</span><b>${S161.money(item.price)}</b></div>`)
    .join("") || `<div class="empty">Цен нет</div>`;
}

function renderRules() {
  $("rules").innerHTML = (state.config.rules || []).map((rule) =>
    `<article class="rule"><h3>${S161.esc(rule.title)}</h3><p>${S161.esc(rule.text)}</p></article>`
  ).join("");
}

function renderBanner() {
  $("list-banner").textContent = state.config.listBanner || "";
  $("code-chip").textContent = state.config.codeWord || "СЕРВИС 161";
}

function renderLocateNote() {
  const note = $("geo-note");
  if (state.pos) {
    note.hidden = false;
    note.innerHTML = `Вы на карте. Точность около ${Math.round(state.accuracy || 0)} м. <button type="button" id="sort-near">Сначала ближайшие</button>`;
    return;
  }
  if (state.posError) {
    note.hidden = false;
    note.innerHTML = `${S161.esc(state.posError)}. <button type="button" id="retry-geo">Повторить</button>`;
    return;
  }
  note.hidden = true;
}

function renderDetail(point) {
  const links = S161.routeLinks(point);
  const status = S161.statusNow(point.hours);
  const distance = S161.formatDistance(S161.distanceKm(state.pos, point));
  const cats = point.categories.map((id) => catById(id)).filter(Boolean);
  const hours = (point.hours || []).map((line) => `<li>${S161.esc(line)}</li>`).join("");
  const contacts = (point.contacts || []).map((contact) => {
    const actions = contactActions(contact);
    return `<div class="contact">
      <div>
        ${contact.name ? `<strong>${S161.esc(contact.name)}</strong><br>` : ""}
        <span>${S161.esc(S161.formatPhone(contact.phone))}</span>
        ${contact.note ? `<br><small>${S161.esc(contact.note)}</small>` : ""}
      </div>
    </div>
    ${actions.map((kind, index) => actionLink(kind, contact, index === 0)).join("")}`;
  }).join("");
  const alt = links.yandexAlt
    ? `<a class="linkish" target="_blank" rel="noopener" href="${S161.esc(links.yandexAlt)}">${S161.esc(links.yandexAltLabel)}</a>`
    : "";
  const navi = links.navi ? `<a class="linkish" href="${S161.esc(links.navi)}">Приложение Яндекс Навигатор</a>` : "";
  const geo = links.geo && phoneDevice ? `<a class="linkish" href="${S161.esc(links.geo)}">Навигатор телефона</a>` : "";
  const route = S161.canNavigate(point) ? `<div class="route-block">
      <a class="btn primary" target="_blank" rel="noopener" href="${S161.esc(links.yandex)}">Поехать через Яндекс</a>
      <div class="route-row">
        <a class="btn" target="_blank" rel="noopener" href="${S161.esc(links.gis)}">2ГИС</a>
        <a class="btn" target="_blank" rel="noopener" href="${S161.esc(links.google)}">Google</a>
      </div>
      <div class="stack">${alt}${navi}${geo}</div>
      ${links.approx ? `<p class="muted">Метка на карте приблизительная. Для поездки надёжнее адрес.</p>` : ""}
    </div>` : `<div class="route-block"><p>Адреса нет — сначала уточните по телефону, потом добавьте его в админке.</p></div>`;

  return `<div class="detail-bar">
      <button type="button" class="back" id="close-detail">Назад</button>
      <h2>${S161.esc(point.name)}</h2>
    </div>
    <p class="addr">${S161.esc(links.address || "Адрес не указан")}</p>
    <div class="meta">
      ${cats.map((category) => `<span class="badge" style="background:${S161.safeColor(category.color)};color:#fff">${S161.esc(category.title)}</span>`).join("")}
      ${point.partner ? `<span class="badge partner">Основной партнёр</span>` : ""}
      ${status.label ? `<span class="badge ${status.state}">${S161.esc(status.label)}</span>` : ""}
      ${distance ? `<span class="badge">${distance}</span>` : ""}
    </div>
    <button type="button" class="code-banner" id="copy-code">
      <span>Скажите на месте<small style="display:block;color:#c8bfb2">Нажмите, чтобы скопировать</small></span>
      <b>${S161.esc(state.config.codeWord)}</b>
    </button>
    ${route}
    <div class="block">
      <strong>Связь</strong>
      ${contacts || "<p class='muted'>Телефонов нет</p>"}
    </div>
    <div class="block">
      <strong>График по Москве</strong>
      ${hours ? `<ul class="hours">${hours}</ul>` : `<p class="muted">Не указан</p>`}
      ${point.hoursNote ? `<p>${S161.esc(point.hoursNote)}</p>` : ""}
    </div>
    ${point.notes ? `<div class="block"><strong>Заметки</strong><p>${S161.esc(point.notes)}</p></div>` : ""}
    <div class="route-row">
      <button type="button" class="btn" id="copy-address">Скопировать адрес</button>
      <button type="button" class="btn" id="share-point">Отправить</button>
    </div>`;
}

function showDetail(id, fly) {
  const point = pointById(id);
  if (!point) {
    closeDetailUI();
    return;
  }
  const distance = S161.distanceKm(state.pos, point);
  const bucket = distance == null ? "" : Math.round(distance * 10);
  const snap = JSON.stringify(point) + state.config.codeWord + bucket;
  const same = detailOpen && state.selected === id && detailSnapshot === snap;
  detailSnapshot = snap;
  state.selected = id;
  detailOpen = true;
  $("detail").classList.add("open");
  if (!same) {
    $("detail").innerHTML = renderDetail(point);
    $("detail").scrollTop = 0;
  }
  highlight();
  if (fly && S161.hasCoords(point) && map) {
    map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 15), { duration: 0.45 });
  }
}

function openDetail(id) {
  showDetail(id, true);
  if (!history.state || history.state.detail !== id) history.pushState({ detail: id }, "");
}

function closeDetailUI() {
  detailOpen = false;
  detailSnapshot = "";
  state.selected = null;
  $("detail").classList.remove("open");
  $("detail").innerHTML = "";
  if (state.config) highlight();
}

function requestClose() {
  if (history.state && history.state.detail) history.back();
  else closeDetailUI();
}

function pinIcon(point, active) {
  return L.divIcon({
    className: "pin-wrap" + (active ? " is-active" : ""),
    html: `<span class="pin" style="background:${pointColor(point)}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function highlight() {
  if (!map) return;
  for (const point of state.config.points) {
    const marker = markers.get(point.id);
    if (marker) marker.setIcon(pinIcon(point, point.id === state.selected));
  }
}

function syncMarkers() {
  if (!map) return;
  for (const marker of markers.values()) marker.remove();
  markers = new Map();
  for (const point of state.config.points) {
    if (!S161.hasCoords(point)) continue;
    const marker = L.marker([point.lat, point.lng], {
      icon: pinIcon(point, point.id === state.selected),
      title: point.name,
    });
    marker.bindTooltip(point.name, { direction: "top", offset: [0, -8] });
    marker.on("click", () => openDetail(point.id));
    marker.addTo(map);
    markers.set(point.id, marker);
  }
}

function fitAll() {
  if (!map) return;
  const coords = state.config.points.filter(S161.hasCoords).map((point) => [point.lat, point.lng]);
  if (state.pos) coords.push([state.pos.lat, state.pos.lng]);
  if (!coords.length) {
    map.setView([47.235, 39.72], 11);
    return;
  }
  map.fitBounds(coords, { padding: [36, 36], maxZoom: 14 });
}

function updateUserDot() {
  if (!map || !state.pos) return;
  const latlng = [state.pos.lat, state.pos.lng];
  if (!userMarker) {
    userMarker = L.circleMarker(latlng, {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#1d4e89",
      fillOpacity: 1,
    }).addTo(map);
    userCircle = L.circle(latlng, {
      radius: Math.max(state.accuracy || 40, 20),
      color: "#1d4e89",
      weight: 1,
      fillColor: "#1d4e89",
      fillOpacity: 0.12,
    }).addTo(map);
    userMarker.bindTooltip("Вы здесь", { direction: "top" });
  } else {
    userMarker.setLatLng(latlng);
    userCircle.setLatLng(latlng);
    userCircle.setRadius(Math.max(state.accuracy || 40, 20));
  }
}

function ensureMap() {
  if (!map) {
    map = L.map("map", { zoomControl: true }).setView([47.235, 39.72], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    syncMarkers();
    fitAll();
    updateUserDot();
  }
  setTimeout(() => map.invalidateSize(), 60);
}

function startLocate(fly) {
  if (!navigator.geolocation) {
    state.posError = "Этот браузер не отдаёт координаты";
    renderLocateNote();
    return;
  }
  if (state.watchId != null && !state.pos) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  if (state.watchId == null) {
    state.watchId = navigator.geolocation.watchPosition(
      (position) => {
        state.pos = { lat: position.coords.latitude, lng: position.coords.longitude };
        state.accuracy = position.coords.accuracy;
        state.posError = "";
        updateUserDot();
        renderCards();
        renderLocateNote();
        if (detailOpen && state.selected) showDetail(state.selected, false);
        if (fly) {
          ensureMap();
          map.setView([state.pos.lat, state.pos.lng], 14);
          fly = false;
        }
      },
      (error) => {
        state.posError = error.code === 1
          ? "Разрешите доступ к местоположению"
          : "Не удалось определить, где вы";
        renderLocateNote();
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 12000 }
    );
  } else if (fly && state.pos) {
    ensureMap();
    map.setView([state.pos.lat, state.pos.lng], 14);
  }
}

function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.view === view);
  });
  if (view === "map" || window.innerWidth >= 960) ensureMap();
  if (view === "map") startLocate(false);
  if (view === "office") renderOffice();
}

function renderAll() {
  renderBanner();
  renderChips();
  renderCards();
  renderOffice();
  renderRules();
  renderLocateNote();
}

async function loadConfig() {
  const response = await fetch("/api/config", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось прочитать config.json");
  const next = await response.json();
  const changed = JSON.stringify(next) !== JSON.stringify(state.config);
  state.config = next;
  if (changed) {
    renderAll();
    if (map) syncMarkers();
    if (detailOpen && state.selected) showDetail(state.selected, false);
  }
}

async function loadInfo() {
  try {
    const response = await fetch("/api/info", { cache: "no-store" });
    const info = await response.json();
    const links = [info.local, ...(info.lan || [])];
    $("lan").innerHTML = links.map((link) => `<a href="${S161.esc(link)}">${S161.esc(link)}</a>`).join("")
      || "<span>Откройте сайт с этого компьютера.</span>";
  } catch {
    $("lan").textContent = "Адрес сети появится, когда сервер ответит.";
  }
}

document.addEventListener("click", (event) => {
  const view = event.target.closest("[data-view]");
  if (view) setView(view.dataset.view);
  const chip = event.target.closest("[data-cat]");
  if (chip) {
    state.cat = chip.dataset.cat;
    renderChips();
    renderCards();
  }
  if (event.target.id === "near" || event.target.id === "sort-near") {
    if (event.target.id === "near" && state.near) state.near = false;
    else {
      state.near = true;
      startLocate(false);
    }
    renderChips();
    renderCards();
  }
  if (event.target.id === "retry-geo" || event.target.id === "locate") {
    ensureMap();
    startLocate(true);
  }
  if (event.target.id === "fit") fitAll();
  const opener = event.target.closest("[data-open]");
  if (opener) openDetail(opener.dataset.open);
  if (event.target.closest("#close-detail")) requestClose();
  if (event.target.closest("#copy-code, #code-chip")) copyText(state.config.codeWord);
  if (event.target.id === "copy-address" && state.selected) {
    copyText(S161.navAddress(pointById(state.selected)));
  }
  if (event.target.id === "share-point" && state.selected) {
    const point = pointById(state.selected);
    const text = `${point.name}\n${S161.navAddress(point)}\nКодовое слово: ${state.config.codeWord}`;
    if (navigator.share) navigator.share({ title: point.name, text }).catch(() => {});
    else copyText(text);
  }
});

$("cards").addEventListener("click", (event) => {
  if (event.target.closest("a, button")) return;
  const card = event.target.closest("[data-id]");
  if (card) openDetail(card.dataset.id);
});

$("q").addEventListener("input", () => {
  state.q = $("q").value;
  renderChips();
  renderCards();
  if (state.view === "office") renderOffice();
});

window.addEventListener("popstate", () => {
  if (history.state && history.state.detail) showDetail(history.state.detail, false);
  else closeDetailUI();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && detailOpen) requestClose();
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    $("q").focus();
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  $("install").hidden = false;
});

$("install").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("install").hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js?v=2").catch(() => {});
}

loadConfig()
  .then(() => {
    if (window.innerWidth >= 960) ensureMap();
    startLocate(false);
  })
  .catch((error) => {
    $("cards").innerHTML = `<div class="empty">${S161.esc(error.message)}</div>`;
  });
loadInfo();
setInterval(() => loadConfig().catch(() => {}), 60000);
window.addEventListener("focus", () => loadConfig().catch(() => {}));
