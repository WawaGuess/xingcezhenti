import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { ensureContent } from './etl.js';
import { apiRoutes } from './app.js';
import { db } from './db.js';

const MISSING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="64" viewBox="0 0 160 64">
  <rect width="160" height="64" rx="8" fill="#eef0f6"/>
  <text x="80" y="38" font-size="13" text-anchor="middle" fill="#8b90a5" font-family="sans-serif">图片缺失</text>
</svg>`;

async function main(): Promise<void> {
  const etl = ensureContent();
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info' },
    bodyLimit: 1024 * 1024,
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'same-origin');
    return payload;
  });

  app.get('/api/health', async () => {
    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM papers) AS papers,
                (SELECT COUNT(*) FROM questions) AS questions,
                (SELECT COUNT(*) FROM paper_questions) AS occurrences,
                (SELECT COUNT(*) FROM materials) AS materials`,
      )
      .get() as Record<string, number>;
    const metaValue = (key: string) =>
      (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
    return {
      ok: true,
      content: { ...counts, ...etl.stats },
      etl: {
        rebuilt: etl.rebuilt,
        ms: etl.ms,
        canonicalQuestions: etl.canonicalQuestions,
        builtAt: metaValue('content_built_at'),
        duplicateOccurrences: metaValue('content_duplicate_occurrences'),
        duplicateMismatch: metaValue('content_duplicate_mismatch'),
      },
    };
  });

  app.setErrorHandler((err, req, reply) => {
    const e = err as any;
    const status = Number(e.status) || Number(e.statusCode) || 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send(e.data || { error: status >= 500 ? 'server_error' : e.message });
  });

  await app.register(apiRoutes, { prefix: '/api' });

  const mediaRoot = path.join(config.contentDir, '90-图片');
  if (fs.existsSync(mediaRoot)) {
    app.get('/media/__missing__.svg', async (_req, reply) => {
      reply.header('Cache-Control', 'public, max-age=86400');
      reply.type('image/svg+xml; charset=utf-8');
      return MISSING_SVG;
    });
    await app.register(fastifyStatic, {
      root: mediaRoot,
      prefix: '/media/',
      cacheControl: true,
      maxAge: '30d',
      immutable: true,
      decorateReply: false,
    });
  }

  const hasWeb = fs.existsSync(path.join(config.webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      cacheControl: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url || '';
    if (url.startsWith('/api/') || url.startsWith('/media/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (hasWeb) return reply.sendFile('index.html');
    return reply
      .code(200)
      .type('text/plain; charset=utf-8')
      .send('前端尚未构建：在 app/ 目录执行 npm run build，或开发时使用 npm run dev:web。');
  });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `行测真题 web 已启动：http://127.0.0.1:${config.port}  ` +
      `content=${config.contentDir} data=${config.dataDir} db=${path.join(config.dataDir, 'app.db')}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
