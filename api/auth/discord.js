import crypto from "node:crypto";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed.");
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send(
      "Discord OAuth belum dikonfigurasi."
    );
  }

  const state = crypto.randomUUID();

  const cookie =
    "discord_oauth_state=" +
    state +
    "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600";

  res.setHeader("Set-Cookie", [cookie]);

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");
  params.set("scope", "identify guilds");
  params.set("state", state);

  const authorizationUrl =
    "https://discord.com/oauth2/authorize?" +
    params.toString();

  return res.redirect(302, authorizationUrl);
}
