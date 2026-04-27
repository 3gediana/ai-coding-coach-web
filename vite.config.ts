import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev 时通过自定义中间件转发到真实 AI endpoint，绕开 CORS。
 *
 * 客户端调用：fetch('/ai-proxy/' + encodeURIComponent('https://.../v1/chat/completions'), ...)
 */
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'aicc-ai-proxy',
      configureServer(server) {
        server.middlewares.use('/ai-proxy', async (req, res) => {
          const encoded = (req.url || '').replace(/^\//, '');
          if (!encoded) {
            res.statusCode = 400;
            res.end('missing target');
            return;
          }
          let target: URL;
          try {
            target = new URL(decodeURIComponent(encoded));
          } catch {
            res.statusCode = 400;
            res.end('invalid target');
            return;
          }

          // 收集 body（本地不流式接收，但发到 AI 后保持流式响应）
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', async () => {
            const body = Buffer.concat(chunks);
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) {
              if (typeof v === 'string') {
                if (k === 'host' || k === 'connection' || k === 'content-length') continue;
                headers[k] = v;
              }
            }
            try {
              const upstream = await fetch(target.toString(), {
                method: req.method ?? 'POST',
                headers,
                body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
              });
              res.statusCode = upstream.status;
              upstream.headers.forEach((v, k) => {
                // 跳过会冲突的 header
                if (
                  k === 'content-encoding' ||
                  k === 'content-length' ||
                  k === 'transfer-encoding'
                ) {
                  return;
                }
                res.setHeader(k, v);
              });
              if (!upstream.body) {
                res.end();
                return;
              }
              const reader = upstream.body.getReader();
              const pump = async () => {
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(Buffer.from(value));
                  }
                } finally {
                  res.end();
                }
              };
              await pump();
            } catch (e: any) {
              res.statusCode = 502;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: String(e?.message || e) }));
            }
          });
        });
      },
    },
  ],
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
