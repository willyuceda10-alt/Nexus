import { afterAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://nexus:nexus@localhost:5432/nexus_test';
process.env.AUTH_MODE = 'dev';
process.env.DEV_AUTH_ENABLED = 'true';
process.env.DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
process.env.DEV_TENANT_ID = '00000000-0000-4000-8000-000000000002';

const { buildApp } = await import('../app.js');
const app = await buildApp();

afterAll(async () => {
  await app.close();
});

describe('health routes', () => {
  it('returns a liveness response without requiring the database', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'nexus-api',
    });
  });
});
