import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const token = req.query?.token;

  if (
    !process.env.DB_CHECK_TOKEN ||
    token !== process.env.DB_CHECK_TOKEN
  ) {
    return res.status(404).json({
      ok: false,
      message: "Not found"
    });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      ok: false,
      message: "DATABASE_URL belum dikonfigurasi"
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`SELECT NOW() AS database_time`;

    return res.status(200).json({
      ok: true,
      message: "Koneksi database berhasil!",
      databaseTime: result[0].database_time
    });
  } catch (error) {
    console.error("Database check failed:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Koneksi database gagal"
    });
  }
}
