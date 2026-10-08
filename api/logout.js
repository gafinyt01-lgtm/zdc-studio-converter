export default function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Set-Cookie",
    "zdc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  );

  return res.status(200).json({
    success: true,
    message: "Kamu berhasil logout."
  });
}
