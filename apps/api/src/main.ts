import { loadConfig, loadDotEnv } from './config/config';
import { createApp } from './app.factory';

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT);
  console.log(`ATLAS-I API listening on http://localhost:${config.PORT} (docs at /docs)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
