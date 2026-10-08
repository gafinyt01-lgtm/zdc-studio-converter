import crypto from "node:crypto";

function parseCookies(req) {
  const result = {};

  for (const item of (req.headers.cookie || "").split(";")) {
    const index = item.indexOf("=");

    if (index < 0) continue;

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = "";
    }
  }

  return result;
}

function createSession(user) {
  const payload = Buffer.from(
    JSON.stringify({
      id: user.id,
      username: user.username,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed.");
  }

  const cookies = parseCookies(req);
  const { code, state, error } = req.query;
  const savedState = cookies.discord_oauth_state;

  const clearState =
    "discord_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

  if (
    error ||
    typeof code !== "string" ||
    typeof state !== "string" ||
    typeof savedState !== "string" ||
    !state ||
    !savedState ||
    state.length !== savedState.length ||
    !crypto.timingSafeEqual(
      Buffer.from(state),
      Buffer.from(savedState)
    )
  ) {
    res.setHeader("Set-Cookie", clearState);
    return res.status(400).send("Otorisasi Discord tidak valid.");
  }

  const {
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    DISCORD_REDIRECT_URI,
    DISCORD_GUILD_ID,
    SESSION_SECRET
  } = process.env;

  if (
    !DISCORD_CLIENT_ID ||
    !DISCORD_CLIENT_SECRET ||
    !DISCORD_REDIRECT_URI ||
    !DISCORD_GUILD_ID ||
    !SESSION_SECRET
  ) {
    res.setHeader("Set-Cookie", clearState);
    return res.status(500).send("Konfigurasi backend belum lengkap.");
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
          code,
          redirect_uri: DISCORD_REDIRECT_URI
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      res.setHeader("Set-Cookie", clearState);
      return res.status(401).send("Login Discord gagal.");
    }

    const headers = {
      Authorization: `Bearer ${tokenData.access_token}`
    };

    const [userResponse, guildsResponse] = await Promise.all([
      fetch("https://discord.com/api/v10/users/@me", { headers }),
      fetch("https://discord.com/api/v10/users/@me/guilds", { headers })
    ]);

    if (!userResponse.ok || !guildsResponse.ok) {
      res.setHeader("Set-Cookie", clearState);
      return res.status(401).send("Gagal memeriksa akun Discord.");
    }

    const user = await userResponse.json();
    const guilds = await guildsResponse.json();

    if (
      !Array.isArray(guilds) ||
      !guilds.some(guild => guild.id === DISCORD_GUILD_ID)
    ) {
      res.setHeader("Set-Cookie", clearState);
      return res.status(403).send(
        "Gabung dengan ZDC Community terlebih dahulu."
      );
    }

    const session = createSession(user);

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Set-Cookie", [
      clearState,
      `zdc_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
    ]);

    return res.redirect(302, "/?login=success");
  } catch {
    res.setHeader("Set-Cookie", clearState);
    return res.status(500).send("Terjadi kesalahan pada proses login.");
  }
}
