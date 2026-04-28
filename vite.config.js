const { defineConfig } = require("vite");

module.exports = defineConfig({
  root: "client",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/v1": "http://localhost:3000"
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
