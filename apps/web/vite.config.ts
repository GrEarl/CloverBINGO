import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

function silenceCommonWsProxyErrors(proxy: unknown) {
  const p = proxy as {
    removeAllListeners?: (event?: string) => void;
    on?: (event: string, listener: (...args: any[]) => void) => void;
  };

  // Vite attaches its proxy error handlers after `configure()` runs.
  // We schedule a microtask to replace them with quieter handlers that ignore
  // common "connection aborted/reset" noise during dev reloads/reconnects.
  queueMicrotask(() => {
    p.removeAllListeners?.("error");
    p.removeAllListeners?.("proxyReqWs");

    p.on?.("error", (err: any, _req: any, res: any) => {
      const code = err?.code as string | undefined;
      if (code === "ECONNABORTED" || code === "ECONNRESET" || code === "EPIPE") {
        try {
          res?.end?.();
        } catch {
          // ignore
        }
        return;
      }

      // Keep non-noise errors visible, but avoid noisy stack traces in the default path.
      // eslint-disable-next-line no-console
      console.error(`[vite proxy] ${code ?? "error"}: ${err?.message ?? String(err)}`);
      try {
        if (res && "writeHead" in res && !res.headersSent && !res.writableEnded) {
          res.writeHead(500, { "Content-Type": "text/plain" }).end();
        } else {
          res?.end?.();
        }
      } catch {
        // ignore
      }
    });

    p.on?.("proxyReqWs", (_proxyReq: any, _req: any, socket: any) => {
      socket?.on?.("error", (err: any) => {
        const code = err?.code as string | undefined;
        if (code === "ECONNABORTED" || code === "ECONNRESET" || code === "EPIPE") return;
        // eslint-disable-next-line no-console
        console.error(`[vite proxy ws] ${code ?? "error"}: ${err?.message ?? String(err)}`);
      });
    });
  });
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
        configure: (proxy) => silenceCommonWsProxyErrors(proxy),
      },
    },
  },
});
