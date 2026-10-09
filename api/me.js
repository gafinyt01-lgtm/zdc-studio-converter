import crypto from "node:crypto";

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

function parseIds(value) {
  if (!value || value.trim().toLowerCase() === "none") {
    return [];
  }

  return value
    .split(",")
    .map(id => id.trim())
    .filter(id => /^\d+$/.test(id));
}

function getRole(userId) {
  const owners = parseIds(process.env.ZDC_OWNER_IDS);
  const premiumUsers = parseIds(process.env.ZDC_PREMIUM_IDS);

  if (owners.includes(userId)) {
    return "OWNER";
  }

  if (premiumUsers.includes(userId)) {
    return "PREMIUM";
  }

  return "FREE";
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      loggedIn: false,
      message: "Method not allowed."
    });
  }

  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return res.status(500).json({
      loggedIn: false,
      message: "Konfigurasi sesi belum tersedia."
    });
  }

  const cookies = parseCookies(req);
  const token = cookies.zdc_session;

  if (!token) {
    return res.status(200).json({
      loggedIn: false
    });
  }

  try {
    const parts = token.split(".");

    if (parts.length !== 2) {
      return res.status(200).json({
        loggedIn: false
      });
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
      return res.status(200).json({
        loggedIn: false
      });
    }

    const user = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (
      !user.id ||
      !user.username ||
      !Number.isFinite(user.exp) ||
      user.exp <= Date.now()
    ) {
      return res.status(200).json({
        loggedIn: false
      });
    }

    const role = getRole(user.id);

    return res.status(200).json({
      loggedIn: true,
      user: {
        id: user.id,
        username: user.username
      },
      role,
      unlimited: role === "OWNER" || role === "PREMIUM",
      dailyLimit: role === "FREE" ? 2 : null
    });
  } catch {
    return res.status(200).json({
      loggedIn: false
    });
  }
}
