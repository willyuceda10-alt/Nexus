import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { config } from './config.js';

export type DocumentBinaryPutInput = {
  storageKey: string;
  content: Buffer;
  contentType: string;
  checksumSha256: string;
};

export type DocumentBinaryReadResult = {
  content: Buffer;
  contentType: string;
  contentLength: number;
  etag?: string;
};

export interface DocumentBinaryStoreV1 {
  put(input: DocumentBinaryPutInput): Promise<void>;
  get(storageKey: string): Promise<DocumentBinaryReadResult | null>;
  delete(storageKey: string): Promise<void>;
}

export class MemoryDocumentBinaryStoreV1 implements DocumentBinaryStoreV1 {
  private readonly values = new Map<string, DocumentBinaryReadResult>();

  async put(input: DocumentBinaryPutInput): Promise<void> {
    this.values.set(input.storageKey, {
      content: Buffer.from(input.content),
      contentType: input.contentType,
      contentLength: input.content.byteLength,
    });
  }

  async get(storageKey: string): Promise<DocumentBinaryReadResult | null> {
    const value = this.values.get(storageKey);
    if (!value) return null;
    return {
      ...value,
      content: Buffer.from(value.content),
    };
  }

  async delete(storageKey: string): Promise<void> {
    this.values.delete(storageKey);
  }
}

class AzureBlobDocumentBinaryStoreV1 implements DocumentBinaryStoreV1 {
  private readonly container;

  constructor() {
    const accountName = config.AZURE_STORAGE_ACCOUNT_NAME!;
    const credential = new DefaultAzureCredential({
      managedIdentityClientId: config.AZURE_CLIENT_ID,
    });
    const blobService = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      credential,
    );
    this.container = blobService.getContainerClient(config.AZURE_DOCUMENT_CONTAINER);
  }

  async put(input: DocumentBinaryPutInput): Promise<void> {
    const client = this.container.getBlockBlobClient(input.storageKey);
    await client.uploadData(input.content, {
      blobHTTPHeaders: { blobContentType: input.contentType },
      metadata: { sha256: input.checksumSha256 },
    });
  }

  async get(storageKey: string): Promise<DocumentBinaryReadResult | null> {
    const client = this.container.getBlockBlobClient(storageKey);
    try {
      const properties = await client.getProperties();
      const content = await client.downloadToBuffer();
      return {
        content,
        contentType: properties.contentType ?? 'application/octet-stream',
        contentLength: Number(properties.contentLength ?? content.byteLength),
        ...(properties.etag ? { etag: properties.etag } : {}),
      };
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404) return null;
      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const client = this.container.getBlockBlobClient(storageKey);
    await client.deleteIfExists({ deleteSnapshots: 'include' });
  }
}

export function createConfiguredDocumentBinaryStoreV1(): DocumentBinaryStoreV1 {
  if (config.DOCUMENT_STORAGE_MODE === 'azure') {
    return new AzureBlobDocumentBinaryStoreV1();
  }
  return new MemoryDocumentBinaryStoreV1();
}
