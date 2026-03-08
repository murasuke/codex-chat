import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    lib: {
      entry: "src/auto-mount.tsx",
      name: "HelpChatWidget",
      fileName: "help-chat-widget",
      formats: ["iife"],
    },
  },
});
