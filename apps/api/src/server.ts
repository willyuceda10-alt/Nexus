import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';

const app = await buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Nexus API shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(
    { host: config.HOST, port: config.PORT, authMode: config.AUTH_MODE },
    'Nexus API started',
  );
} catch (error) {
  app.log.fatal({ err: error }, 'Nexus API failed to start');
  await prisma.$disconnect();
  process.exit(1);
}
