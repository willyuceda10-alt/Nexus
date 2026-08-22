export interface ApiActor {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: string;
  email: string;
  name: string;
}

export interface ApiTenant {
  id: string;
  name: string;
  slug: string;
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | 'CUSTOM';
  status: 'ACTIVE' | 'SUSPENDED' | 'PROVISIONING' | 'DELETED';
  metadata: unknown;
}

export interface ApiWorkspace {
  id: string;
  name: string;
  code: string;
  description: string | null;
  role: string;
}

export interface ApiObjectDefinition {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  schema: unknown;
  permissions: unknown;
  isSystem: boolean;
}

export interface BootstrapResponse {
  product: {
    name: string;
    apiVersion: string;
  };
  actor: ApiActor;
  tenant: ApiTenant;
  workspaces: ApiWorkspace[];
  objectDefinitions: ApiObjectDefinition[];
}

export interface ApiErrorPayload {
  error?: string;
  message?: string;
  correlationId?: string;
  details?: unknown;
}
