// server/index.mjs - Fastify bootstrap for the faber-web backend.
//
// Serves:
//   - REST routes (applications, reports, jobs)
//   - SSE /api/events stream
//   - Static built frontend (only in production; Vite handles dev)
//
// Configuration:
//   CAREER_OPS_ROOT   path to the project root (defaults to parent of this dir)
//   PORT              HTTP port (default 7433)
//   HOST              HTTP host (default 127.0.0.1)

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { startWatchers } from './watchers/files.mjs';
import { JobManager } from './jobs/manager.mjs';
import { registerApplicationsRoutes } from './routes/applications.mjs';
import { registerReportsRoutes } from './routes/reports.mjs';
import { registerJobsRoutes } from './routes/jobs.mjs';
import { registerEventsRoute } from './routes/events.mjs';
import { registerOnboardingRoutes } from './onboarding/index.mjs';
import { cleanupStaleTemp } from './onboarding/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const careerOpsRoot = path.resolve(
  process.env.CAREER_OPS_ROOT ?? path.join(__dirname, '..', '..'),
);
const port = Number(process.env.PORT ?? 7433);
const host = process.env.HOST ?? '127.0.0.1';

async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: { colorize: true, singleLine: true },
      } : undefined,
    },
    trustProxy: false,
  });

  await app.register(fastifyCors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'] });

  // Multipart for resume uploads. Cap is enforced again per-file in
  // onboarding/multipart.mjs; this is the outer envelope.
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,  // 10 MB
      files: 1,
      fields: 4,
      fieldSize: 1_500_000,
    },
  });

  // Shared state captured into route closures.
  const state = { applicationsFilePath: null };

  // File watchers fan out to SSE subscribers.
  const { emitter: fileEmitter, close: closeWatchers } = startWatchers(careerOpsRoot);

  // Job manager tracks subprocess lifecycle.
  const jobs = new JobManager({ careerOpsRoot });

  // Best-effort sweep of stale onboarding tmp files from previous runs.
  try {
    const swept = await cleanupStaleTemp(careerOpsRoot);
    app.log.info(`onboarding tmp sweep: removed ${swept.removed} stale files in ${swept.dir}`);
  } catch (err) {
    app.log.warn({ err }, 'onboarding tmp sweep failed (non-fatal)');
  }

  registerApplicationsRoutes(app, { careerOpsRoot, state });
  registerReportsRoutes(app, { careerOpsRoot });
  registerJobsRoutes(app, { careerOpsRoot, jobs });
  registerOnboardingRoutes(app, { careerOpsRoot, jobs });
  registerEventsRoute(app, { fileEmitter, jobs });

  app.get('/api/health', async () => ({
    ok: true,
    careerOpsRoot,
    version: '0.1.0',
  }));

  // Serve the built frontend in production.
  const distDir = path.resolve(__dirname, '..', 'dist', 'app');
  if (existsSync(distDir)) {
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: '/',
      wildcard: false,
    });
    // SPA fallback.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  const shutdown = async () => {
    await closeWatchers();
    jobs.shutdown();
    await app.close();
  };

  return { app, shutdown };
}

(async () => {
  const { app, shutdown } = await buildServer();
  try {
    await app.listen({ host, port });
    app.log.info(`faber-web listening on http://${host}:${port}`);
    app.log.info(`faber root: ${careerOpsRoot}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  process.on('SIGINT', async () => {
    app.log.info('SIGINT received; shutting down');
    await shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    app.log.info('SIGTERM received; shutting down');
    await shutdown();
    process.exit(0);
  });
})();
