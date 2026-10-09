import { defineConfig } from "vite";

export default defineConfig({
publicDir: "public",

build: {
outDir: "dist",
emptyOutDir: true,
assetsDir: "assets",

rollupOptions: {
  input: {
    main: "index.html",
    audioTest: "audio-test.html"
  }
}

},

worker: {
format: "es"
}
});
