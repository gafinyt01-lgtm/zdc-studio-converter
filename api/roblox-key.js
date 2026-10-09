import crypto from "node:crypto";
import { getPool } from "./db.js";

// ============================================
// PENGATURAN COOKIE
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
// PEMERIKSAAN SESI DISCORD
// ============================================

function verifySession(req) {
    const token = parseCookies(req).zdc_session;
    const secret = process.env.SESSION_SECRET;

    if (!token || !secret) {
        return null;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
        return null;
    }

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
// ENKRIPSI ROBLOX API KEY
// AES-256-GCM
// ============================================

function encryptApiKey(apiKey) {
    const secret = process.env.ENCRYPTION_KEY;

    if (!secret) {
        throw new Error("ENCRYPTION_KEY belum diatur.");
    }

    const encryptionKey = Buffer.from(secret, "base64");

    if (encryptionKey.length !== 32) {
        throw new Error(
            "ENCRYPTION_KEY harus berupa 32 byte dalam format Base64."
        );
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

    const authTag = cipher.getAuthTag();

    return [
        "v1",
        iv.toString("hex"),
        authTag.toString("hex"),
        encrypted.toString("hex")
    ].join(":");
}

// ============================================
// PEMERIKSAAN API KEY
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
// HANDLER UTAMA
// ============================================

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    res.setHeader("X-Content-Type-Options", "nosniff");

    // Hanya izinkan GET dan POST.
    if (!["GET", "POST"].includes(req.method)) {
        res.setHeader("Allow", "GET, POST");

        return res.status(405).json({
            ok: false,
            message: "Metode tidak diizinkan."
        });
    }

    // Periksa sesi Discord.
    const session = verifySession(req);

    if (!session) {
        return res.status(401).json({
            ok: false,
            message: "Silakan login melalui Discord terlebih dahulu."
        });
    }

    // Lindungi permintaan POST dari origin yang tidak dikenal.
    if (req.method === "POST") {
        const origin = req.headers.origin;

        if (origin) {
            try {
                const originUrl = new URL(origin);
                const host = req.headers.host;

                if (
                    !host ||
                    originUrl.host.toLowerCase() !== host.toLowerCase() ||
                    !["https:", "http:"].includes(originUrl.protocol)
                ) {
                    return res.status(403).json({
                        ok: false,
                        message: "Asal permintaan tidak diizinkan."
                    });
                }
            } catch {
                return res.status(403).json({
                    ok: false,
                    message: "Asal permintaan tidak valid."
                });
            }
        }

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
        // GET: PERIKSA APAKAH API KEY TERSIMPAN
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
        // POST: SIMPAN API KEY TERENKRIPSI
        // ========================================

        const apiKey = req.body?.apiKey;

        if (!validateApiKey(apiKey)) {
            return res.status(400).json({
                ok: false,
                message: "API Key tidak valid."
            });
        }

        // Enkripsi sebelum menyimpan ke database.
        const encryptedApiKey = encryptApiKey(apiKey);

        // Simpan data akun Discord.
        // Jika akun sudah ada, jangan menimpa role pengguna.
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

        // Simpan atau perbarui API Key terenkripsi.
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
        // Jangan mencatat API Key atau data rahasia ke log.
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
