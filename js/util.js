(function () {
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function safeColor(color) {
    return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#e24d12";
  }

  function digits(phone) {
    return String(phone || "").replace(/\D/g, "");
  }

  function isMobile(phone) {
    const value = digits(phone);
    return value.length === 11 && value.startsWith("79");
  }

  function formatPhone(phone) {
    const value = digits(phone);
    if (value.length === 11 && value.startsWith("7")) {
      if (value[1] === "9") {
        return `+7 ${value.slice(1, 4)} ${value.slice(4, 7)}-${value.slice(7, 9)}-${value.slice(9)}`;
      }
      return `+7 (${value.slice(1, 4)}) ${value.slice(4, 7)}-${value.slice(7, 9)}-${value.slice(9)}`;
    }
    return String(phone || "");
  }

  function money(value) {
    return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
  }

  function hasCoords(point) {
    return Number.isFinite(point.lat) && Number.isFinite(point.lng);
  }

  function navAddress(point) {
    const address = (point.address || "").trim();
    const locality = (point.locality || "").trim();
    if (address && locality) return `${address}, ${locality}`;
    return address || locality;
  }

  function canNavigate(point) {
    return hasCoords(point) || Boolean((point.address || "").trim());
  }

  function routeLinks(point) {
    const address = navAddress(point);
    const coords = hasCoords(point);
    const house = coords && point.precision === "house";
    const yandexAddress = address
      ? "https://yandex.ru/maps/?rtext=~" + encodeURIComponent(address) + "&rtt=auto"
      : "";
    const yandexCoord = coords
      ? `https://yandex.ru/maps/?rtext=~${point.lat},${point.lng}&rtt=auto`
      : "";
    const googleDest = house ? `${point.lat},${point.lng}` : address || (coords ? `${point.lat},${point.lng}` : "");
    return {
      address,
      yandex: house ? yandexCoord : yandexAddress,
      yandexAlt: house ? yandexAddress : yandexCoord,
      yandexAltLabel: house ? "Если мимо двери — маршрут по адресу" : "Маршрут по точке на карте",
      navi: coords ? `yandexnavi://build_route_on_map?lat_to=${point.lat}&lon_to=${point.lng}` : "",
      geo: coords ? `geo:${point.lat},${point.lng}?q=${point.lat},${point.lng}(${encodeURIComponent(point.name || "Точка")})` : "",
      gis: coords
        ? `https://2gis.ru/rostov-on-don/directions/points/|${point.lng},${point.lat}`
        : `https://2gis.ru/rostov-on-don/search/${encodeURIComponent(address)}`,
      google: googleDest
        ? "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + encodeURIComponent(googleDest)
        : "",
      approx: coords && point.precision !== "house",
    };
  }

  const DAY_INDEX = { пн: 0, вт: 1, ср: 2, чт: 3, пт: 4, сб: 5, вс: 6 };
  const DAY_ORDER = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

  function daysFromLine(line) {
    const range = line.match(/(вс|пн|вт|ср|чт|пт|сб)\s*-\s*(вс|пн|вт|ср|чт|пт|сб)/);
    if (range) {
      let start = DAY_INDEX[range[1]];
      let end = DAY_INDEX[range[2]];
      if (end < start) end += 7;
      const days = [];
      for (let i = start; i <= end; i += 1) days.push(DAY_ORDER[i % 7]);
      return days;
    }
    const one = line.match(/(вс|пн|вт|ср|чт|пт|сб)/);
    return one ? [one[1]] : [];
  }

  function parseSchedule(lines) {
    const slots = new Map();
    for (const raw of lines || []) {
      const line = String(raw).toLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
      if (!line) continue;
      const days = daysFromLine(line);
      if (!days.length) continue;
      const closed = /(вых|выходн|закрыт)/.test(line);
      const allDay = /24\s*\/\s*7|круглосут/.test(line);
      const time = line.match(/(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})/);
      let slot = null;
      if (closed) slot = { closed: true };
      else if (time) slot = { start: Number(time[1]) * 60 + Number(time[2]), end: Number(time[3]) * 60 + Number(time[4]) };
      else if (allDay) slot = { start: 0, end: 24 * 60 };
      if (!slot) continue;
      for (const day of days) slots.set(day, slot);
    }
    return slots;
  }

  function moscowNow() {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((part) => [part.type, part.value]));
    const map = { Sun: "вс", Mon: "пн", Tue: "вт", Wed: "ср", Thu: "чт", Fri: "пт", Sat: "сб" };
    return {
      day: map[(parts.weekday || "").replace(".", "").slice(0, 3)],
      mins: Number(parts.hour) * 60 + Number(parts.minute),
    };
  }

  function statusNow(lines) {
    if (!lines || !lines.length) return { state: "unknown", label: "" };
    const slots = parseSchedule(lines);
    if (!slots.size) return { state: "unknown", label: "" };
    const now = moscowNow();
    if (!now.day || !Number.isFinite(now.mins)) return { state: "unknown", label: "" };
    const slot = slots.get(now.day);
    if (!slot) return { state: "partial", label: "Сегодня в графике нет" };
    if (slot.closed) return { state: "closed", label: "Сейчас закрыто" };
    if (now.mins >= slot.start && now.mins < slot.end) return { state: "open", label: "Сейчас открыто" };
    return { state: "closed", label: "Сейчас закрыто" };
  }

  function distanceKm(from, point) {
    if (!from || !hasCoords(point)) return null;
    const rad = Math.PI / 180;
    const dLat = (point.lat - from.lat) * rad;
    const dLng = (point.lng - from.lng) * rad;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(from.lat * rad) * Math.cos(point.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function formatDistance(km) {
    if (km == null) return "";
    if (km < 1) return `${Math.round(km * 1000)} м`;
    const text = km < 10 ? km.toFixed(1) : String(Math.round(km));
    return text.replace(".", ",") + " км";
  }

  window.S161 = {
    esc,
    safeColor,
    digits,
    isMobile,
    formatPhone,
    money,
    hasCoords,
    navAddress,
    canNavigate,
    routeLinks,
    statusNow,
    distanceKm,
    formatDistance,
  };
})();
