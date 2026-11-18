import { getStore } from "@netlify/blobs";

function store() {
  return getStore("service161");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function passwordOf(data) {
  return data && typeof data.adminPassword === "string" && data.adminPassword
    ? data.adminPassword
    : "161161";
}

function forSite(data) {
  const copy = JSON.parse(JSON.stringify(data));
  delete copy.adminPassword;
  return copy;
}

async function seedConfig() {
  const origin = process.env.DEPLOY_PRIME_URL || process.env.URL;
  if (!origin) return null;
  try {
    const response = await fetch(new URL("/config.json", origin));
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || !Array.isArray(data.points)) return null;
    return data;
  } catch {
    return null;
  }
}

async function currentConfig() {
  try {
    const saved = await store().get("config", { type: "json", consistency: "strong" });
    if (saved && Array.isArray(saved.points)) return saved;
  } catch {
    /* first visit, before anything is saved */
  }
  return seedConfig();
}

export default async (request) => {
  if (request.method === "GET") {
    const data = await currentConfig();
    if (!data) return json({ error: "Справочник не открылся" }, 404);
    return json(forSite(data));
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Не удалось прочитать данные" }, 400);
  }

  if (request.method === "POST") {
    const data = await currentConfig();
    if (!data) return json({ error: "Справочник не открылся" }, 404);
    if (!body || body.password !== passwordOf(data)) return json({ error: "Неверный пароль" }, 401);
    return json({ ok: true });
  }

  if (request.method === "PUT") {
    if (!body || !Array.isArray(body.points) || body.points.length > 500) {
      return json({ error: "Не удалось записать" }, 400);
    }
    const data = await currentConfig();
    const expected = passwordOf(data);
    if ((request.headers.get("x-admin-password") || "") !== expected) {
      return json({ error: "Войдите снова" }, 401);
    }
    const nextPassword = typeof body.adminPassword === "string" && body.adminPassword.length >= 4
      ? body.adminPassword
      : expected;
    body.adminPassword = nextPassword;
    body.updatedAt = new Date().toISOString();
    await store().set("config", JSON.stringify(body));
    return json({ ok: true });
  }

  return json({ error: "Не удалось записать" }, 405);
};
