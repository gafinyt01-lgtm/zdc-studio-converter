import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

const FFMPEG_CORE_URL =
"https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

let ffmpegInstance = null;
let ffmpegLoading = null;

export async function loadAudioProcessor(onProgress = () => {}) {
if (ffmpegInstance) return ffmpegInstance;
if (ffmpegLoading) return ffmpegLoading;

ffmpegLoading = (async () => {
const ffmpeg = new FFmpeg();

ffmpeg.on("progress", ({ progress }) => {
  onProgress(
    Math.max(0, Math.min(100, Math.round(progress * 100)))
  );
});

const coreURL = await toBlobURL(
  `${FFMPEG_CORE_URL}/ffmpeg-core.js`,
  "text/javascript"
);

const wasmURL = await toBlobURL(
  `${FFMPEG_CORE_URL}/ffmpeg-core.wasm`,
  "application/wasm"
);

await ffmpeg.load({ coreURL, wasmURL });

ffmpegInstance = ffmpeg;
return ffmpeg;

})();

try {
return await ffmpegLoading;
} catch (error) {
ffmpegLoading = null;
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

const MAX_FILE_SIZE = 5 * 1024 * 1024;

if (file.size > MAX_FILE_SIZE) {
throw new Error("Ukuran audio maksimal 5 MB.");
}

if (!/.(mp3|wav|ogg|flac|m4a|aac|webm)$/i.test(file.name)) {
throw new Error("Format audio belum didukung.");
}

const ffmpeg = await loadAudioProcessor(onProgress);

const extension =
file.name.match(/.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "mp3";

const inputName = "input.${extension}";
const outputName = "zdc-output.mp3";

try {
await ffmpeg.writeFile(
inputName,
new Uint8Array(await file.arrayBuffer())
);

onProgress(0);

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

if (!(outputData instanceof Uint8Array) || outputData.length === 0) {
  throw new Error("Hasil konversi kosong.");
}

const outputBlob = new Blob([outputData], {
  type: "audio/mpeg"
});

onProgress(100);

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
