import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const optionalNonEmptyString = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalUrlString = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(8080),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    AUTH_MODE: z.enum(['entra', 'dev']).default('entra'),
    ENTRA_API_CLIENT_ID: z.string().uuid().optional(),
    ENTRA_TENANT_ID: z.string().uuid().optional(),
    ENTRA_REQUIRED_SCOPE: z.string().trim().min(1).default('access_as_user'),
    DEV_AUTH_ENABLED: booleanFromEnv.default('false'),
    DEV_USER_ID: z.string().uuid().optional(),
    DEV_TENANT_ID: z.string().uuid().optional(),
    OUTBOX_WORKER_ENABLED: booleanFromEnv.default('false'),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
    OUTBOX_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    OUTBOX_IDLE_DELAY_MS: z.coerce.number().int().min(250).max(60000).default(5000),
    OUTBOX_LOOP_DELAY_MS: z.coerce.number().int().min(100).max(10000).default(1000),
    OUTBOX_TENANT_SCAN_LIMIT: z.coerce.number().int().min(1).max(1000).default(100),
    AUTOMATION_WORKER_ENABLED: booleanFromEnv.default('false'),
    AUTOMATION_RECEIVE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(55).default(20),
    AUTOMATION_LOOP_DELAY_MS: z.coerce.number().int().min(50).max(10000).default(250),
    NOTIFICATION_WORKER_ENABLED: booleanFromEnv.default('false'),
    NOTIFICATION_WORKER_AVAILABLE: booleanFromEnv.default('false'),
    NOTIFICATION_RECEIVE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(55).default(20),
    NOTIFICATION_LOOP_DELAY_MS: z.coerce.number().int().min(50).max(10000).default(250),
    MEETING_CALENDAR_WORKER_ENABLED: booleanFromEnv.default('false'),
    MEETING_CALENDAR_WORKER_AVAILABLE: booleanFromEnv.default('false'),
    MEETING_CALENDAR_RECEIVE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(55).default(20),
    MEETING_CALENDAR_LOOP_DELAY_MS: z.coerce.number().int().min(50).max(10000).default(250),
    SERVICE_BUS_NAMESPACE: optionalNonEmptyString,
    SERVICE_BUS_TOPIC: z.string().trim().min(1).default('bridata-domain-events'),
    SERVICE_BUS_AUTOMATION_SUBSCRIPTION: z.string().trim().min(1).default('automation-v1'),
    SERVICE_BUS_NOTIFICATION_SUBSCRIPTION: z.string().trim().min(1).default('notifications-v1'),
    SERVICE_BUS_MEETING_SUBSCRIPTION: z.string().trim().min(1).default('meetings-v1'),
    M365_GRAPH_DELIVERY_ENABLED: booleanFromEnv.default('false'),
    M365_CALENDAR_SYNC_ENABLED: booleanFromEnv.default('false'),
    M365_AVAILABILITY_ENABLED: booleanFromEnv.default('false'),
    M365_OUTLOOK_SENDER_USER: optionalNonEmptyString,
    M365_TEAMS_ACTIVITY_TYPE: optionalNonEmptyString,
    M365_TEAMS_TOPIC_WEB_URL: optionalUrlString,
    M365_TEAMS_TOPIC_VALUE: z.string().trim().min(1).max(255).default('Bridata'),
    AZURE_CLIENT_ID: z.string().uuid().optional(),
    DOCUMENT_STORAGE_MODE: z.enum(['memory', 'azure']).default('memory'),
    AZURE_STORAGE_ACCOUNT_NAME: optionalNonEmptyString,
    AZURE_DOCUMENT_CONTAINER: z.string().trim().min(3).max(63).default('bridata-documents'),
    DOCUMENT_MAX_FILE_BYTES: z.coerce.number().int().min(1_048_576).max(104_857_600).default(26_214_400),
    INTEGRATION_STORAGE_MODE: z.enum(['memory', 'azure']).default('memory'),
    AZURE_INTEGRATION_CONTAINER: z.string().trim().min(3).max(63).default('bridata-imports'),
    INTEGRATION_MAX_FILE_BYTES: z.coerce.number().int().min(1_048_576).max(209_715_200).default(52_428_800),
    INTEGRATION_PARSE_MAX_FILE_BYTES: z.coerce.number().int().min(1_048_576).max(52_428_800).default(26_214_400),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'entra') {
      if (!env.ENTRA_API_CLIENT_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ENTRA_API_CLIENT_ID'],
          message: 'ENTRA_API_CLIENT_ID is required when AUTH_MODE=entra',
        });
      }

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

    if (
      (
        env.OUTBOX_WORKER_ENABLED
        || env.AUTOMATION_WORKER_ENABLED
        || env.NOTIFICATION_WORKER_ENABLED
        || env.MEETING_CALENDAR_WORKER_ENABLED
      )
      && !env.SERVICE_BUS_NAMESPACE
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SERVICE_BUS_NAMESPACE'],
        message: 'SERVICE_BUS_NAMESPACE is required when an async worker is enabled.',
      });
    }

    if (env.INTEGRATION_PARSE_MAX_FILE_BYTES > env.INTEGRATION_MAX_FILE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['INTEGRATION_PARSE_MAX_FILE_BYTES'],
        message: 'INTEGRATION_PARSE_MAX_FILE_BYTES cannot exceed INTEGRATION_MAX_FILE_BYTES.',
      });
    }

    if (env.INTEGRATION_STORAGE_MODE === 'azure') {
      if (!env.AZURE_STORAGE_ACCOUNT_NAME) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AZURE_STORAGE_ACCOUNT_NAME'],
          message: 'AZURE_STORAGE_ACCOUNT_NAME is required when INTEGRATION_STORAGE_MODE=azure.',
        });
      }
      if (!env.AZURE_CLIENT_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AZURE_CLIENT_ID'],
          message: 'AZURE_CLIENT_ID is required for the user-assigned managed identity integration store.',
        });
      }
    }

    if (env.DOCUMENT_STORAGE_MODE === 'azure') {
      if (!env.AZURE_STORAGE_ACCOUNT_NAME) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AZURE_STORAGE_ACCOUNT_NAME'],
          message: 'AZURE_STORAGE_ACCOUNT_NAME is required when DOCUMENT_STORAGE_MODE=azure.',
        });
      }
      if (!env.AZURE_CLIENT_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AZURE_CLIENT_ID'],
          message: 'AZURE_CLIENT_ID is required for the user-assigned managed identity document store.',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.flatten().fieldErrors;
  throw new Error(`Invalid Bridata Project API configuration: ${JSON.stringify(details)}`);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
};

export type BridataConfig = typeof config;
