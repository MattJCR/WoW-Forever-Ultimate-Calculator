import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base './' (rutas relativas) hace que el mismo build funcione en la raiz de un dominio
// y en https://<usuario>.github.io/<repositorio>/ sin configurar nada. El router usa '#'.
export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  plugins: [react()],
  server: { port: 5173, host: true },
});
