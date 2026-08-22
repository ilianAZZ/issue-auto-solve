import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { loadEnv, loadGlobalConfig } from './config/index.js';
import { openDatabase } from './db/index.js';
import { Store } from './db/store.js';
import { Orchestrator } from './core/orchestrator.js';
import { Credentials } from './core/credentials.js';
import { SecretStore } from './db/secrets.js';
import { createServer } from './server/app.js';
import { resolveDashboardToken } from './server/auth.js';
import { logger } from './util/log.js';

const log = logger('issue-auto-solve');

async function main() {
  const env = loadEnv();
  const config = loadGlobalConfig(resolve(env.CONFIG_FILE));

  for (const dir of [env.STATE_DIR, env.WORKSPACE_DIR, env.LOG_DIR]) mkdirSync(resolve(dir), { recursive: true });

  const db = openDatabase(join(resolve(env.STATE_DIR), 'issue-auto-solve.db'));
  const store = new Store(db);
  const secrets = new SecretStore(db, join(resolve(env.STATE_DIR), 'master.key'));
  const credentials = new Credentials(env, secrets);
  const orchestrator = new Orchestrator(env, config, store, credentials);
  orchestrator.seedRepositories();

  const dashboardToken = resolveDashboardToken(env.DASHBOARD_TOKEN, join(resolve(env.STATE_DIR), 'dashboard.token'));
  const server = await createServer(env, store, orchestrator, credentials, dashboardToken);
  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  log.info(`dashboard on ${env.PUBLIC_URL}/login?token=${dashboardToken}`);

  await orchestrator.start();
  log.info(
    orchestrator.configured
      ? `polling every ${config.poll_interval_seconds}s, ${config.max_concurrent_runs} run(s) at a time`
      : `setup incomplete — finish it at ${env.PUBLIC_URL}`,
  );

  const shutdown = async () => {
    log.info('shutting down');
    orchestrator.stop();
    await server.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  log.error(String(error?.stack ?? error));
  process.exit(1);
});
