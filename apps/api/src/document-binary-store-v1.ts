import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  SASProtocol,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { config } from './config.js';

export type DocumentBinaryPutInput = {
  storageKey: string;
  fileName: string;
  content: Buffer;
  contentType: string;
  checksumSha256: string;
};

export type DocumentBinaryReadAccess = {
  url: string;
  expiresAt: Date;
};

export interface DocumentBinaryStoreV1 {
  put(input: DocumentBinaryPutInput): Promise<void>;
  createReadUrl(storageKey: string): Promise<DocumentBinaryReadAccess | null>;
  delete(storageKey: string): Promise<void>;
}

function contentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export class MemoryDocumentBinaryStoreV1 implements DocumentBinaryStoreV1 {
  private readonly values = new Map<string, DocumentBinaryPutInput>();

  async put(input: DocumentBinaryPutInput): Promise<void> {
    this.values.set(input.storageKey, {
      ...input,
      content: Buffer.from(input.content),
    });
  }

  async createReadUrl(storageKey: string): Promise<DocumentBinaryReadAccess | null> {
    const value = this.values.get(storageKey);
    if (!value) return null;
    return {
      url: `data:${value.contentType};base64,${value.content.toString('base64')}`,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    };
  }

  async delete(storageKey: string): Promise<void> {
    this.values.delete(storageKey);
  }
}

class AzureBlobDocumentBinaryStoreV1 implements DocumentBinaryStoreV1 {
  private readonly accountName: string;
  private readonly containerName: string;
  private readonly blobService: BlobServiceClient;
  private readonly container: ContainerClient;

  constructor() {
    this.accountName = config.AZURE_STORAGE_ACCOUNT_NAME!;
    this.containerName = config.AZURE_DOCUMENT_CONTAINER;
    const managedIdentityClientId = config.AZURE_CLIENT_ID;
    if (!managedIdentityClientId) {
      throw new Error('AZURE_CLIENT_ID is required for the Azure document binary store.');
    }
    const credential = new DefaultAzureCredential({ managedIdentityClientId });
    this.blobService = new BlobServiceClient(
      `https://${this.accountName}.blob.core.windows.net`,
      credential,
    );
    this.container = this.blobService.getContainerClient(this.containerName);
  }

  async put(input: DocumentBinaryPutInput): Promise<void> {
    const client = this.container.getBlockBlobClient(input.storageKey);
    await client.uploadData(input.content, {
      blobHTTPHeaders: {
        blobContentType: input.contentType,
        blobContentDisposition: contentDisposition(input.fileName),
      },
      metadata: { sha256: input.checksumSha256 },
    });
  }

  async createReadUrl(storageKey: string): Promise<DocumentBinaryReadAccess | null> {
    const client = this.container.getBlockBlobClient(storageKey);
    try {
      await client.getProperties();
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404) return null;
      throw error;
    }

    const startsOn = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const userDelegationKey = await this.blobService.getUserDelegationKey(startsOn, expiresAt);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: storageKey,
        permissions: BlobSASPermissions.parse('r'),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn: expiresAt,
      },
      userDelegationKey,
      this.accountName,
    ).toString();

    return {
      url: `${client.url}?${sas}`,
      expiresAt,
    };
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
  if (config.NODE_ENV === 'production') {
    throw new Error('DOCUMENT_STORAGE_MODE=azure is required for the Bridata API in production.');
  }
  return new MemoryDocumentBinaryStoreV1();
}
