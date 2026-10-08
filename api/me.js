import crypto from "node:crypto";

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

  const cookie = (req.headers.cookie || "")
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith("zdc_session="));

  if (!cookie) {
    return res.status(200).json({
      loggedIn: false
    });
  }

  try {
    const token = decodeURIComponent(
      cookie.slice("zdc_session=".length)
    );

    const parts = token.split(".");

    if (parts.length !== 2) {
      return res.status(200).json({ loggedIn: false });
    }

    const [payload, signature] = parts;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");

    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      return res.status(200).json({ loggedIn: false });
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
      return res.status(200).json({ loggedIn: false });
    }

    return res.status(200).json({
      loggedIn: true,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch {
    return res.status(200).json({ loggedIn: false });
  }
}
