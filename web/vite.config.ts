import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base:process.env.VITE_BASE || '/Amahane_Hikari/',
  resolve:{alias:{'@framework':fileURLToPath(new URL('./vendor/Framework/src',import.meta.url))}},
  build:{target:'es2022',sourcemap:false},
  server:{strictPort:true},
  preview:{headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"}},
});
