import express, { type Request, type Response } from 'express';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const PY_HOST = '127.0.0.1';
const DEFAULT_PY_PORT = Number(process.env.PY_BACKEND_PORT || 8001);

let pyPort = DEFAULT_PY_PORT;
let pyProc: ChildProcess | null = null;
let pyReady = false;
let pyEnsurePromise: Promise<void> | null = null;

function resolvePythonCommand(): { cmd: string; argsPrefix: string[] } {
  if (process.env.PYTHON_BIN) {
    return { cmd: process.env.PYTHON_BIN, argsPrefix: [] };
  }

  const candidates =
    process.platform === 'win32'
      ? [
          { cmd: 'py', argsPrefix: ['-3'] },
          { cmd: 'py', argsPrefix: [] },
          { cmd: 'python', argsPrefix: [] },
          { cmd: 'python3', argsPrefix: [] },
        ]
      : [
          { cmd: 'python3', argsPrefix: [] },
          { cmd: 'python', argsPrefix: [] },
        ];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.cmd, [...candidate.argsPrefix, '--version'], {
      stdio: 'ignore',
      timeout: 2000,
    });
    if (probe.status === 0 && !probe.error) {
      return candidate;
    }
  }

  return { cmd: process.platform === 'win32' ? 'py' : 'python3', argsPrefix: [] };
}

let lastHealthError = '';

function checkPythonHealth(port = pyPort): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: PY_HOST,
        port,
        path: '/api/py/health',
        timeout: 2000,
        agent: false,
        headers: { Connection: 'close' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            lastHealthError = `HTTP ${res.statusCode}`;
            resolve(false);
            return;
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
              status?: string;
              engine?: string;
            };
            if (parsed.status === 'ok' && typeof parsed.engine === 'string' && parsed.engine.includes('python')) {
              lastHealthError = '';
              resolve(true);
            } else {
              lastHealthError = 'unexpected health response';
              resolve(false);
            }
          } catch {
            lastHealthError = 'invalid health JSON';
            resolve(false);
          }
        });
      },
    );
    req.on('error', (err) => {
      lastHealthError = err.message;
      resolve(false);
    });
    req.on('timeout', () => {
      lastHealthError = 'request timed out';
      req.destroy();
      resolve(false);
    });
  });
}

function tryBindPort(port: number, host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once('error', () => resolve(null));
    tester.listen({ port, host, exclusive: true }, () => {
      const addr = tester.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      tester.close(() => resolve(boundPort));
    });
  });
}

async function pickFreePort(preferred: number): Promise<number> {
  const candidates = [preferred, 8002, 8003, 8004, 8005, 8010, 0];
  for (const candidate of candidates) {
    const bound = await tryBindPort(candidate, PY_HOST);
    if (bound) return bound;
  }
  return preferred;
}

async function ensurePythonBackend(): Promise<void> {
  if (pyEnsurePromise) {
    return pyEnsurePromise;
  }

  pyEnsurePromise = (async () => {
    if (await checkPythonHealth(pyPort)) {
      pyReady = true;
      return;
    }

    pyPort = await pickFreePort(DEFAULT_PY_PORT);
    const scriptPath = path.resolve(__dirname, 'backend', 'server.py');
    const { cmd, argsPrefix } = resolvePythonCommand();

    let exitedEarly = false;
    pyProc = spawn(cmd, [...argsPrefix, scriptPath], {
      cwd: __dirname,
      env: {
        ...process.env,
        HOST: PY_HOST,
        PY_BACKEND_PORT: String(pyPort),
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pyProc.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    pyProc.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    pyProc.on('exit', (code) => {
      exitedEarly = true;
      pyReady = false;
      console.error(`[server] Python RL backend exited with code ${code}`);
      pyProc = null;
    });

    // Poll readiness up to 10 seconds, aborting immediately if process exits
    for (let i = 0; i < 40; i++) {
      if (exitedEarly) break;
      if (await checkPythonHealth(pyPort)) {
        pyReady = true;
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    console.error(
      `[server] Python RL backend did not respond in time (${lastHealthError || 'unknown error'}).`,
    );
  })().finally(() => {
    pyEnsurePromise = null;
  });

  return pyEnsurePromise;
}

function cleanupPython(): void {
  if (pyProc && !pyProc.killed) {
    pyProc.kill('SIGTERM');
    pyProc = null;
  }
}

process.on('SIGINT', () => {
  cleanupPython();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupPython();
  process.exit(0);
});
process.on('exit', cleanupPython);

function proxyToPython(req: Request, res: Response, isStream: boolean): void {
  // Strictly map /api/<rest> -> /api/py/<rest> on fixed loopback 127.0.0.1
  const suffix = req.originalUrl.replace(/^\/api/, '');
  if (!suffix.startsWith('/') || suffix.includes('..')) {
    res.status(400).json({ error: 'Invalid API path.' });
    return;
  }
  const targetPath = `/api/py${suffix}`;

  const headers: http.OutgoingHttpHeaders = {
    Accept: isStream ? 'text/event-stream' : 'application/json',
  };
  let bodyBuffer: Buffer | null = null;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
    bodyBuffer = Buffer.from(JSON.stringify(req.body), 'utf-8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = bodyBuffer.length;
  }

  const proxyReq = http.request(
    {
      host: PY_HOST,
      port: pyPort,
      path: targetPath,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      if (isStream) {
        res.status(proxyRes.statusCode || 200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        proxyRes.pipe(res);
      } else {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (c: Buffer) => chunks.push(c));
        proxyRes.on('end', () => {
          const raw = Buffer.concat(chunks);
          res.status(proxyRes.statusCode || 502);
          res.setHeader(
            'Content-Type',
            proxyRes.headers['content-type'] || 'application/json; charset=utf-8',
          );
          res.send(raw);
        });
      }
    },
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(503).json({
        error: `Python RL engine unavailable: ${err.message}`,
      });
    } else {
      res.end();
    }
  });

  if (isStream) {
    req.on('close', () => {
      proxyReq.destroy();
    });
  }

  if (bodyBuffer) {
    proxyReq.write(bodyBuffer);
  }
  proxyReq.end();
}

async function startServer(): Promise<void> {
  await ensurePythonBackend();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Health check
  app.get('/api/health', async (_req, res) => {
    const alive = await checkPythonHealth();
    pyReady = alive;
    res.status(alive ? 200 : 503).json({
      status: alive ? 'ok' : 'degraded',
      pythonEngine: alive ? 'ready' : 'unavailable',
    });
  });

  // SSE stream route
  app.get('/api/runs/:id/stream', (req, res) => {
    if (!/^[a-zA-Z0-9_-]{4,40}$/.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid run identifier.' });
      return;
    }
    proxyToPython(req, res, true);
  });

  // General API proxy to Python backend
  app.use('/api', async (req, res) => {
    if (!pyReady) {
      await ensurePythonBackend();
    }
    proxyToPython(req, res, false);
  });

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Meridian RL workstation running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  cleanupPython();
  process.exit(1);
});
