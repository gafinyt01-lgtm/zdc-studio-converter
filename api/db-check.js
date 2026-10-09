import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({
      ok: false,
      message: "Not found"
    });
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return res.status(500).json({
      ok: false,
      message: "DATABASE_URL belum dikonfigurasi"
    });
  }

  try {
    const sql = neon(databaseUrl);
    const result = await sql`SELECT NOW() AS database_time`;

    return res.status(200).json({
      ok: true,
      message: "Koneksi database berhasil",
      databaseTime: result[0].database_time
    });
  } catch {
    return res.status(500).json({
      ok: false,
      message: "Koneksi database gagal. Periksa konfigurasi Vercel."
    });
  }
}
