import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // BUG: Missing proxy configuration for /api routes
  // Should proxy /api to http://localhost:8000
});
