import crypto from "node:crypto";
import { getPool } from "./db.js";

// ============================================
// COOKIE
// ============================================

function parseCookies(req) {
    const cookies = {};
    const header = req.headers.cookie || "";

    for (const item of header.split(";")) {
        const index = item.indexOf("=");
        if (index < 0) continue;

        const name = item.slice(0, index).trim();
        const value = item.slice(index + 1).trim();

        try {
            cookies[name] = decodeURIComponent(value);
        } catch {
            cookies[name] = "";
        }
    }

    return cookies;
}

// ============================================
// VERIFIKASI SESI DISCORD
// ============================================

function verifySession(req) {
    const token = parseCookies(req).zdc_session;
    const secret = process.env.SESSION_SECRET;

    if (!token || !secret) return null;

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
        const session = JSON.parse(
            Buffer.from(payload, "base64url").toString("utf8")
        );

        if (
            typeof session.id !== "string" ||
            !/^\d+$/.test(session.id) ||
            typeof session.username !== "string" ||
            !session.username ||
            !Number.isFinite(session.exp) ||
            session.exp <= Date.now()
        ) {
            return null;
        }

        return session;
    } catch {
        return null;
    }
}

// ============================================
// ENKRIPSI AES-256-GCM
// ============================================

function encryptApiKey(apiKey) {
    const secret = process.env.ENCRYPTION_KEY;

    if (!secret) {
        throw new Error("Konfigurasi enkripsi belum tersedia.");
    }

    const encryptionKey = Buffer.from(secret, "base64");

    if (encryptionKey.length !== 32) {
        throw new Error("Konfigurasi enkripsi tidak valid.");
    }

    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        encryptionKey,
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(apiKey, "utf8"),
        cipher.final()
    ]);

    return [
        "v1",
        iv.toString("hex"),
        cipher.getAuthTag().toString("hex"),
        encrypted.toString("hex")
    ].join(":");
}

// ============================================
// VALIDASI
// ============================================

function validateApiKey(apiKey) {
    return (
        typeof apiKey === "string" &&
        apiKey.length >= 10 &&
        apiKey.length <= 4096 &&
        apiKey.trim() === apiKey &&
        !/[\r\n]/.test(apiKey)
    );
}

// ============================================
// PEMERIKSAAN ASAL PERMINTAAN
// ============================================

function isAllowedOrigin(req) {
    const origin = req.headers.origin;
    const host = req.headers.host;

    if (!origin || !host) return false;

    try {
        const url = new URL(origin);

        return (
            ["https:", "http:"].includes(url.protocol) &&
            url.host.toLowerCase() === host.toLowerCase()
        );
    } catch {
        return false;
    }
}

// ============================================
// HANDLER UTAMA
// ============================================

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (!["GET", "POST", "DELETE"].includes(req.method)) {
        res.setHeader("Allow", "GET, POST, DELETE");

        return res.status(405).json({
            ok: false,
            message: "Metode tidak diizinkan."
        });
    }

    const session = verifySession(req);

    if (!session) {
        return res.status(401).json({
            ok: false,
            message: "Silakan login melalui Discord terlebih dahulu."
        });
    }

    // Semua operasi yang mengubah data harus berasal
    // dari origin website yang sama.
    if (
        ["POST", "DELETE"].includes(req.method) &&
        !isAllowedOrigin(req)
    ) {
        return res.status(403).json({
            ok: false,
            message: "Asal permintaan tidak diizinkan."
        });
    }

    if (req.method === "POST") {
        const contentType = req.headers["content-type"] || "";

        if (!contentType.toLowerCase().includes("application/json")) {
            return res.status(415).json({
                ok: false,
                message: "Gunakan format application/json."
            });
        }
    }

    try {
        const pool = getPool();

        // ========================================
        // GET: PERIKSA STATUS
        // ========================================

        if (req.method === "GET") {
            const result = await pool.query(
                `SELECT 1
                 FROM roblox_credentials
                 WHERE discord_id = $1
                 LIMIT 1`,
                [session.id]
            );

            return res.status(200).json({
                ok: true,
                configured: result.rowCount > 0
            });
        }

        // ========================================
        // DELETE: HAPUS API KEY
        // ========================================

        if (req.method === "DELETE") {
            const result = await pool.query(
                `DELETE FROM roblox_credentials
                 WHERE discord_id = $1`,
                [session.id]
            );

            return res.status(200).json({
                ok: true,
                configured: false,
                deleted: result.rowCount > 0,
                message: result.rowCount > 0
                    ? "API Key berhasil dihapus."
                    : "Tidak ada API Key yang tersimpan."
            });
        }

        // ========================================
        // POST: SIMPAN API KEY
        // ========================================

        const apiKey = req.body?.apiKey;

        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                ok: false,
                message: "API Key tidak valid."
            });
        }

        const encryptedApiKey = encryptApiKey(apiKey);

        // Pastikan data pengguna tersedia.
        await pool.query(
            `INSERT INTO users (
                discord_id,
                username,
                role
            )
            VALUES ($1, $2, 'FREE')
            ON CONFLICT (discord_id)
            DO UPDATE SET
                username = EXCLUDED.username,
                updated_at = NOW()`,
            [session.id, session.username]
        );

        // Simpan hanya data terenkripsi.
        await pool.query(
            `INSERT INTO roblox_credentials (
                discord_id,
                encrypted_api_key,
                created_at,
                updated_at
            )
            VALUES ($1, $2, NOW(), NOW())
            ON CONFLICT (discord_id)
            DO UPDATE SET
                encrypted_api_key = EXCLUDED.encrypted_api_key,
                updated_at = NOW()`,
            [session.id, encryptedApiKey]
        );

        return res.status(200).json({
            ok: true,
            configured: true,
            message: "API Key berhasil disimpan secara terenkripsi."
        });

    } catch (error) {
        // Jangan pernah mencatat API Key atau token ke log.
        console.error(
            "Roblox credential operation failed:",
            error.message
        );

        return res.status(500).json({
            ok: false,
            message: "Terjadi kesalahan saat memproses API Key."
        });
    }
}
