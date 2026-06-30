import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { hydrateLocalStore } from './lib/local-store';
import { hydrateManualRecords } from './lib/manual-records';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// 启动时先从远端 blob 恢复本地数据（未配置 Supabase 时为无操作）。
async function bootstrapPersistence() {
  await Promise.all([hydrateLocalStore(), hydrateManualRecords()]);
}

bootstrapPersistence().finally(() => app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
  });
}));
