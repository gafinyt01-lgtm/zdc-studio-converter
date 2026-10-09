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

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      ok: false,
      message: "Metode tidak diizinkan."
    });
  }

  let user;

  try {
    user = verifySession(req);
  } catch (error) {
    console.error("History session error:", error.message);

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

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      ok: false,
      message: "Database belum dikonfigurasi."
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Hapus catatan yang sudah melewati waktu kedaluwarsa.
    // Tidak menghapus aset yang tersimpan di Roblox.
    await sql`
      DELETE FROM conversion_history
      WHERE expires_at <= NOW()
    `;

    // Tampilkan riwayat milik pengguna yang sedang login saja.
    const rows = await sql`
      SELECT
        id,
        audio_name,
        roblox_asset_id,
        status,
        created_at,
        expires_at
      FROM conversion_history
      WHERE discord_id = ${user.id}
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 50
    `;

    return res.status(200).json({
      ok: true,
      history: rows
    });
  } catch (error) {
    console.error("History API error:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Gagal mengambil riwayat konversi."
    });
  }
}
