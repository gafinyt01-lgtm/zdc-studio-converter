import crypto from "node:crypto";

export default async function handler(req, res) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [
          item.slice(0, index),
          decodeURIComponent(item.slice(index + 1))
        ];
      })
  );

  const { code, state, error } = req.query;
  const savedState = cookies.discord_oauth_state;

  res.setHeader("Set-Cookie", [
    "discord_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  ]);

  if (error || !code || !state || !savedState ||
      !crypto.timingSafeEqual(
        Buffer.from(String(state)),
        Buffer.from(String(savedState))
      )) {
    return res.status(400).send("Otorisasi Discord gagal atau tidak valid.");
  }

  const {
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    DISCORD_REDIRECT_URI,
    DISCORD_GUILD_ID
  } = process.env;

  if (
    !DISCORD_CLIENT_ID ||
    !DISCORD_CLIENT_SECRET ||
    !DISCORD_REDIRECT_URI ||
    !DISCORD_GUILD_ID
  ) {
    return res.status(500).send("Konfigurasi Discord belum lengkap.");
  }

  try {
    const tokenResponse = await fetch(
      "https://discord.com/api/v10/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code: String(code),
          redirect_uri: DISCORD_REDIRECT_URI
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(401).send("Gagal mengautentikasi akun Discord.");
    }

    const headers = {
      Authorization: `Bearer ${tokenData.access_token}`
    };

    const [userResponse, guildsResponse] = await Promise.all([
      fetch("https://discord.com/api/v10/users/@me", { headers }),
      fetch("https://discord.com/api/v10/users/@me/guilds", { headers })
    ]);

    if (!userResponse.ok || !guildsResponse.ok) {
      return res.status(401).send("Gagal memeriksa akun Discord.");
    }

    const user = await userResponse.json();
    const guilds = await guildsResponse.json();

    const isMember = guilds.some(
      (guild) => guild.id === DISCORD_GUILD_ID
    );

    if (!isMember) {
      return res.status(403).send(
        "Kamu harus bergabung dengan server ZDC Community terlebih dahulu."
      );
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      status: "success",
      message: "Login Discord berhasil dan keanggotaan ZDC Community terverifikasi.",
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch {
    return res.status(500).send("Terjadi kesalahan saat menghubungkan Discord.");
  }
}
