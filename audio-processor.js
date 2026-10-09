import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

const CORE_BASE =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

let ffmpegInstance = null;
let loadingPromise = null;

export async function loadAudioProcessor(onProgress = () => {}) {
  if (ffmpegInstance) {
    return ffmpegInstance;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    const ffmpeg = new FFmpeg();

    ffmpeg.on("log", ({ message }) => {
      console.log("[ZDC FFmpeg]", message);
    });

    ffmpeg.on("progress", ({ progress }) => {
      onProgress(
        `Memproses audio: ${Math.round(progress * 100)}%`
      );
    });

    try {
      onProgress("Mengunduh mesin FFmpeg...");

      const coreURL = await toBlobURL(
        `${CORE_BASE}/ffmpeg-core.js`,
        "text/javascript"
      );

      onProgress("Mengunduh komponen WASM...");

      const wasmURL = await toBlobURL(
        `${CORE_BASE}/ffmpeg-core.wasm`,
        "application/wasm"
      );

      onProgress("Menjalankan mesin FFmpeg...");

      await ffmpeg.load({
        coreURL,
        wasmURL
      });

      ffmpegInstance = ffmpeg;

      onProgress("Mesin FFmpeg siap!");

      return ffmpeg;
    } catch (error) {
      console.error("Gagal memuat FFmpeg:", error);

      throw new Error(
        `Mesin FFmpeg gagal dimuat: ${
          error?.message || String(error)
        }`
      );
    }
  })();

  try {
    return await loadingPromise;
  } catch (error) {
    loadingPromise = null;
    throw error;
  }
}

export async function convertAudio(
  file,
  { onProgress = () => {} } = {}
) {
  if (!(file instanceof File)) {
    throw new Error("Pilih berkas audio terlebih dahulu.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Ukuran audio maksimal 5 MB.");
  }

  if (!/\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i.test(file.name)) {
    throw new Error("Format audio belum didukung.");
  }

  const ffmpeg = await loadAudioProcessor(onProgress);

  const extension =
    file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "mp3";

  const inputName = `input.${extension}`;
  const outputName = "zdc-output.mp3";

  try {
    onProgress("Membaca berkas audio...");

    await ffmpeg.writeFile(
      inputName,
      new Uint8Array(await file.arrayBuffer())
    );

    onProgress("Mengonversi audio...");

    await ffmpeg.exec([
      "-y",
      "-i", inputName,
      "-vn",
      "-af", "volume=-8dB,atempo=2.0,atempo=1.15",
      "-b:a", "192k",
      "-codec:a", "libmp3lame",
      outputName
    ]);

    const outputData = await ffmpeg.readFile(outputName);

    if (!outputData || outputData.length === 0) {
      throw new Error("Hasil konversi kosong.");
    }

    const outputBlob = new Blob([outputData], {
      type: "audio/mpeg"
    });

    onProgress("Konversi selesai!");

    return {
      blob: outputBlob,
      filename:
        file.name.replace(/\.[^.]+$/, "").slice(0, 100) + ".mp3",
      size: outputBlob.size,
      type: "audio/mpeg"
    };
  } finally {
    for (const name of [inputName, outputName]) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        // Abaikan jika berkas belum dibuat.
      }
    }
  }
}
