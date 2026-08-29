import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  SASProtocol,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { config } from './config.js';

export type IntegrationBinaryPutInput = {
  storageKey: string;
  fileName: string;
  content: Buffer;
  contentType: string;
  checksumSha256: string;
  sourceKey: string;
};

export type IntegrationBinaryReadAccess = {
  url: string;
  expiresAt: Date;
};

export interface IntegrationBinaryStoreV1 {
  put(input: IntegrationBinaryPutInput): Promise<void>;
  createReadUrl(storageKey: string): Promise<IntegrationBinaryReadAccess | null>;
  delete(storageKey: string): Promise<void>;
}

function contentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export class MemoryIntegrationBinaryStoreV1 implements IntegrationBinaryStoreV1 {
  private readonly values = new Map<string, IntegrationBinaryPutInput>();

  async put(input: IntegrationBinaryPutInput): Promise<void> {
    this.values.set(input.storageKey, { ...input, content: Buffer.from(input.content) });
  }

  async createReadUrl(storageKey: string): Promise<IntegrationBinaryReadAccess | null> {
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

class AzureBlobIntegrationBinaryStoreV1 implements IntegrationBinaryStoreV1 {
  private readonly accountName: string;
  private readonly containerName: string;
  private readonly blobService: BlobServiceClient;
  private readonly container: ContainerClient;

  constructor() {
    const accountName = config.AZURE_STORAGE_ACCOUNT_NAME;
    const managedIdentityClientId = config.AZURE_CLIENT_ID;
    if (!accountName) {
      throw new Error('AZURE_STORAGE_ACCOUNT_NAME is required for the Azure integration binary store.');
    }
    if (!managedIdentityClientId) {
      throw new Error('AZURE_CLIENT_ID is required for the Azure integration binary store.');
    }

    this.accountName = accountName;
    this.containerName = config.AZURE_INTEGRATION_CONTAINER;
    const credential = new DefaultAzureCredential({ managedIdentityClientId });
    this.blobService = new BlobServiceClient(
      `https://${this.accountName}.blob.core.windows.net`,
      credential,
    );
    this.container = this.blobService.getContainerClient(this.containerName);
  }

  async put(input: IntegrationBinaryPutInput): Promise<void> {
    const client = this.container.getBlockBlobClient(input.storageKey);
    await client.uploadData(input.content, {
      blobHTTPHeaders: {
        blobContentType: input.contentType,
        blobContentDisposition: contentDisposition(input.fileName),
      },
      metadata: {
        sha256: input.checksumSha256,
        sourcekey: input.sourceKey,
      },
    });
  }

  async createReadUrl(storageKey: string): Promise<IntegrationBinaryReadAccess | null> {
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

    return { url: `${client.url}?${sas}`, expiresAt };
  }

  async delete(storageKey: string): Promise<void> {
    await this.container.getBlockBlobClient(storageKey).deleteIfExists({ deleteSnapshots: 'include' });
  }
}

export function createConfiguredIntegrationBinaryStoreV1(): IntegrationBinaryStoreV1 {
  if (config.INTEGRATION_STORAGE_MODE === 'azure') {
    return new AzureBlobIntegrationBinaryStoreV1();
  }
  if (config.NODE_ENV === 'production') {
    throw new Error('INTEGRATION_STORAGE_MODE=azure is required for the Bridata API in production.');
  }
  return new MemoryIntegrationBinaryStoreV1();
}
