import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(8080),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    AUTH_MODE: z.enum(['entra', 'dev']).default('entra'),
    ENTRA_CLIENT_ID: z.string().uuid().optional(),
    DEV_AUTH_ENABLED: booleanFromEnv.default('false'),
    DEV_USER_ID: z.string().uuid().optional(),
    DEV_TENANT_ID: z.string().uuid().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'entra' && !env.ENTRA_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENTRA_CLIENT_ID'],
        message: 'ENTRA_CLIENT_ID is required when AUTH_MODE=entra',
      });
    }

    if (env.AUTH_MODE === 'dev') {
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_MODE'],
          message: 'AUTH_MODE=dev is forbidden in production',
        });
      }
      if (!env.DEV_AUTH_ENABLED || !env.DEV_USER_ID || !env.DEV_TENANT_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DEV_AUTH_ENABLED'],
          message: 'Dev auth requires DEV_AUTH_ENABLED=true, DEV_USER_ID and DEV_TENANT_ID',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.flatten().fieldErrors;
  throw new Error(`Invalid Nexus API configuration: ${JSON.stringify(details)}`);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
};

export type NexusConfig = typeof config;
