import { bridataApi } from '../api/client';
import type { ApiObjectDefinition, ListObjectsParams } from '../api/contracts';
import type { NexusObject, User } from '../types/nexus';
import {
  apiObjectToNexusObject,
  hasMetadataChanges,
  nexusObjectMetadata,
} from './apiAdapters';

export interface ObjectRepositoryContext {
  tenantId: string;
  workspaceId: string;
  currentUser: User;
  objectDefinitions?: ApiObjectDefinition[];
}

export interface ObjectListResult {
  items: NexusObject[];
  nextCursor: string | null;
}

export interface ObjectRepository {
  list(params?: ListObjectsParams, signal?: AbortSignal): Promise<ObjectListResult>;
  create(data: Partial<NexusObject>, context: ObjectRepositoryContext): Promise<NexusObject>;
  update(
    existing: NexusObject,
    updates: Partial<NexusObject>,
    context: ObjectRepositoryContext,
  ): Promise<NexusObject>;
  delete(existing: NexusObject): Promise<void>;
}

function localCreate(
  data: Partial<NexusObject>,
  context: ObjectRepositoryContext,
): NexusObject {
  const now = new Date().toISOString();
  return {
    id: `${data.type?.toLowerCase().slice(0, 3) || 'obj'}-${crypto.randomUUID()}`,
    tenantId: context.tenantId,
    workspaceId: data.workspaceId || context.workspaceId,
    type: data.type || 'TASK',
    title: data.title || 'Nuevo Objeto sin Título',
    description: data.description || '',
    status: data.status || 'DRAFT',
    priority: data.priority || 'MEDIUM',
    ownerId: context.currentUser.id,
    ownerName: context.currentUser.name,
    ownerAvatar: context.currentUser.avatar,
    assigneeId: data.assigneeId || context.currentUser.id,
    assigneeName: data.assigneeName || context.currentUser.name,
    assigneeAvatar: data.assigneeAvatar || context.currentUser.avatar,
    startDate: data.startDate || now.slice(0, 10),
    endDate: data.endDate || now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
    progress: data.progress ?? 0,
    version: 1,
    ...data,
  };
}

export class InMemoryObjectRepository implements ObjectRepository {
  private items: NexusObject[];

  constructor(initialItems: NexusObject[]) {
    this.items = initialItems.map((item) => ({ ...item }));
  }

  async list(params: ListObjectsParams = {}): Promise<ObjectListResult> {
    let items = this.items.filter((item) => {
      if (params.workspaceId && item.workspaceId !== params.workspaceId) return false;
      if (params.type && item.type !== params.type) return false;
      if (params.status && item.status !== params.status) return false;
      return true;
    });

    const limit = params.limit ?? items.length;
    items = items.slice(0, limit);
    return { items: items.map((item) => ({ ...item })), nextCursor: null };
  }

  async create(data: Partial<NexusObject>, context: ObjectRepositoryContext): Promise<NexusObject> {
    const created = localCreate(data, context);
    this.items = [created, ...this.items];
    return { ...created };
  }

  async update(
    existing: NexusObject,
    updates: Partial<NexusObject>,
  ): Promise<NexusObject> {
    const updated: NexusObject = {
      ...existing,
      ...updates,
      version: (existing.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.items = this.items.map((item) => (item.id === existing.id ? updated : item));
    return { ...updated };
  }

  async delete(existing: NexusObject): Promise<void> {
    this.items = this.items.filter((item) => item.id !== existing.id);
  }
}

type UpdateWaiter = {
  resolve: (value: NexusObject) => void;
  reject: (reason?: unknown) => void;
};

type PendingUpdateBatch = {
  baseHint: NexusObject;
  updates: Partial<NexusObject>;
  context: ObjectRepositoryContext;
  waiters: UpdateWaiter[];
  timer: ReturnType<typeof setTimeout>;
};

const UPDATE_BUFFER_MS = 300;

export class ApiObjectRepository implements ObjectRepository {
  private readonly confirmed = new Map<string, NexusObject>();
  private readonly pending = new Map<string, PendingUpdateBatch>();
  private readonly chains = new Map<string, Promise<NexusObject>>();

  async list(params: ListObjectsParams = {}, signal?: AbortSignal): Promise<ObjectListResult> {
    const response = await bridataApi.listObjects(params, signal);
    const items = response.items.map((item) => apiObjectToNexusObject(item));
    for (const item of items) this.confirmed.set(item.id, item);
    return {
      items,
      nextCursor: response.nextCursor,
    };
  }

  async create(data: Partial<NexusObject>, context: ObjectRepositoryContext): Promise<NexusObject> {
    const type = data.type ?? 'TASK';
    const definition = context.objectDefinitions?.find((item) => item.key === type);
    if (!definition) {
      throw new Error(`No existe una definición de objeto para ${type}.`);
    }

    const response = await bridataApi.createObject({
      workspaceId: data.workspaceId || context.workspaceId,
      objectDefinitionId: definition.id,
      objectTypeKey: type,
      title: data.title?.trim() || 'Nuevo Objeto sin Título',
      ...(data.description !== undefined ? { description: data.description } : {}),
      status: data.status ?? 'DRAFT',
      priority: data.priority ?? 'MEDIUM',
      progress: data.progress ?? 0,
      ...(data.assigneeId ? { assigneeId: data.assigneeId } : {}),
      ...(data.startDate ? { startDate: data.startDate } : {}),
      ...(data.endDate ? { dueDate: data.endDate } : {}),
      metadata: nexusObjectMetadata(data),
    });

    const created = apiObjectToNexusObject(response, context.currentUser);
    this.confirmed.set(created.id, created);
    return created;
  }

  update(
    existing: NexusObject,
    updates: Partial<NexusObject>,
    context: ObjectRepositoryContext,
  ): Promise<NexusObject> {
    return new Promise<NexusObject>((resolve, reject) => {
      const current = this.pending.get(existing.id);
      if (current) {
        clearTimeout(current.timer);
        current.updates = { ...current.updates, ...updates };
        current.context = context;
        current.waiters.push({ resolve, reject });
        current.timer = setTimeout(() => {
          this.startFlush(existing.id);
        }, UPDATE_BUFFER_MS);
        return;
      }

      const batch: PendingUpdateBatch = {
        baseHint: this.confirmed.get(existing.id) ?? existing,
        updates: { ...updates },
        context,
        waiters: [{ resolve, reject }],
        timer: setTimeout(() => {
          this.startFlush(existing.id);
        }, UPDATE_BUFFER_MS),
      };
      this.pending.set(existing.id, batch);
    });
  }

  async delete(existing: NexusObject): Promise<void> {
    const pending = this.pending.get(existing.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.startFlush(existing.id);
    }

    const inFlight = this.chains.get(existing.id);
    if (inFlight) await inFlight;

    await bridataApi.deleteObject(existing.id);
    this.confirmed.delete(existing.id);
    this.pending.delete(existing.id);
    this.chains.delete(existing.id);
  }

  private startFlush(id: string): void {
    const batch = this.pending.get(id);
    if (!batch) return;
    this.pending.delete(id);
    clearTimeout(batch.timer);

    const previous = this.chains.get(id) ?? Promise.resolve(this.confirmed.get(id) ?? batch.baseHint);
    const operation = previous.then((base) =>
      this.performUpdate(base, batch.updates, batch.context),
    );
    this.chains.set(id, operation);

    void operation
      .then((updated) => {
        this.confirmed.set(id, updated);
        batch.waiters.forEach((waiter) => waiter.resolve(updated));
      })
      .catch((error) => {
        batch.waiters.forEach((waiter) => waiter.reject(error));
      })
      .finally(() => {
        if (this.chains.get(id) === operation) {
          this.chains.delete(id);
        }
      });
  }

  private async performUpdate(
    existing: NexusObject,
    updates: Partial<NexusObject>,
    context: ObjectRepositoryContext,
  ): Promise<NexusObject> {
    if (!existing.version) {
      throw new Error('El objeto no tiene versión de servidor; recárgalo antes de guardar.');
    }

    const merged = { ...existing, ...updates };
    const response = await bridataApi.updateObject(existing.id, {
      version: existing.version,
      ...(updates.title !== undefined ? { title: updates.title } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
      ...(updates.progress !== undefined ? { progress: updates.progress } : {}),
      ...(updates.assigneeId !== undefined ? { assigneeId: updates.assigneeId ?? null } : {}),
      ...(updates.startDate !== undefined ? { startDate: updates.startDate ?? null } : {}),
      ...(updates.endDate !== undefined ? { dueDate: updates.endDate ?? null } : {}),
      ...(hasMetadataChanges(updates) ? { metadata: nexusObjectMetadata(merged) } : {}),
    });

    return apiObjectToNexusObject(response, context.currentUser, merged);
  }
}
