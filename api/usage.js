import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

function parseCookies(req) {
  const cookies = {};

  for (const item of (req.headers.cookie || "").split(";")) {
    const index = item.indexOf("=");

    if (index < 0) continue;

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = "";
    }
  }

  return cookies;
}

function getTodayWIB() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function getRole(userId) {
  const owners = (process.env.ZDC_OWNER_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(id => /^\d+$/.test(id));

  const premiumUsers = (process.env.ZDC_PREMIUM_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(id => /^\d+$/.test(id));

  if (owners.includes(userId)) return "OWNER";
  if (premiumUsers.includes(userId)) return "PREMIUM";

  return "FREE";
}

function verifySession(req) {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET belum dikonfigurasi");
  }

  const token = parseCookies(req).zdc_session;

  if (!token) return null;

  const parts = token.split(".");

  if (parts.length !== 2) return null;

  const [payload, signature] = parts;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    return null;
  }

  try {
    const user = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (
      !user.id ||
      !/^\d+$/.test(user.id) ||
      !Number.isFinite(user.exp) ||
      user.exp <= Date.now()
    ) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");

    return res.status(405).json({
      ok: false,
      message: "Metode tidak diizinkan."
    });
  }

  let user;

  try {
    user = verifySession(req);
  } catch (error) {
    console.error("Session configuration error:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Konfigurasi sesi belum tersedia."
    });
  }

  if (!user) {
    return res.status(401).json({
      ok: false,
      message: "Silakan login melalui Discord terlebih dahulu."
    });
  }

  const role = getRole(user.id);
  const unlimited = role === "OWNER" || role === "PREMIUM";

  if (unlimited) {
    return res.status(200).json({
      ok: true,
      role,
      unlimited: true,
      dailyLimit: null,
      used: 0,
      remaining: null,
      message: "Akses tanpa batas aktif."
    });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      ok: false,
      message: "Database belum dikonfigurasi."
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const today = getTodayWIB();

    if (req.method === "GET") {
      const rows = await sql`
        SELECT usage_count
        FROM daily_usage
        WHERE discord_id = ${user.id}
          AND usage_date = ${today}::date
        LIMIT 1
      `;

      const used = Number(rows[0]?.usage_count || 0);

      return res.status(200).json({
        ok: true,
        role,
        unlimited: false,
        dailyLimit: 2,
        used,
        remaining: Math.max(0, 2 - used),
        date: today
      });
    }

    const rows = await sql`
      INSERT INTO daily_usage (
        discord_id,
        usage_date,
        usage_count,
        created_at,
        updated_at
      )
      VALUES (
        ${user.id},
        ${today}::date,
        1,
        NOW(),
        NOW()
      )
      ON CONFLICT (discord_id, usage_date)
      DO UPDATE SET
        usage_count = daily_usage.usage_count + 1,
        updated_at = NOW()
      WHERE daily_usage.usage_count < 2
      RETURNING usage_count
    `;

    if (rows.length === 0) {
      const current = await sql`
        SELECT usage_count
        FROM daily_usage
        WHERE discord_id = ${user.id}
          AND usage_date = ${today}::date
        LIMIT 1
      `;

      return res.status(429).json({
        ok: false,
        role,
        unlimited: false,
        dailyLimit: 2,
        used: Number(current[0]?.usage_count || 2),
        remaining: 0,
        message: "Batas gratis hari ini sudah habis."
      });
    }

    const used = Number(rows[0].usage_count);

    return res.status(200).json({
      ok: true,
      role,
      unlimited: false,
      dailyLimit: 2,
      used,
      remaining: Math.max(0, 2 - used),
      message: "Pemakaian berhasil dicatat."
    });
  } catch (error) {
    console.error("Usage API error:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Gagal memproses pemakaian."
    });
  }
}
