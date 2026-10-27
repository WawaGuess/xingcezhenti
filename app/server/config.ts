import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// here is app/server (dev, tsx) or app/dist-server (built)
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..');

export const config = {
  port: Number(process.env.PORT || 8090),
  host: process.env.HOST || '0.0.0.0',
  contentDir: process.env.CONTENT_DIR || repoRoot,
  dataDir: process.env.DATA_DIR || path.join(repoRoot, 'data'),
  webDist: path.join(appRoot, 'dist'),
  appRoot,
  repoRoot,
};
