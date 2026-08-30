export type ApiSapInventoryMovementTypeV1G4 = '101' | '102' | '221' | '222';

export interface ApiSapInventoryMovementV1G4 {
  id: string;
  externalKey: string;
  fiscalYear: string | null;
  materialDocumentNumber: string | null;
  materialDocumentItem: string | null;
  sapMovementType: ApiSapInventoryMovementTypeV1G4 | null;
  label: string;
  canonicalMovementType: string;
  quantity: number;
  signedQuantity: number;
  occurredAt: string;
  materialId: string;
  materialCode: string;
  materialTitle: string;
  uomCode: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  wbsElement: string | null;
  purchaseOrderNumber: string | null;
  purchaseOrderPosition: string | null;
}

export interface ApiSapInventoryV1G4 {
  version: 'v1g4';
  canonicalDatabase: 'BRIDATA_POSTGRESQL';
  excelRuntimeDependency: false;
  workspaceId: string;
  generatedAt: string;
  summary: {
    movementCount: number;
    materialCount: number;
    warehouseCount: number;
    receipt101Count: number;
    reversal102Count: number;
    issue221Count: number;
    reversal222Count: number;
    lastSapActivityAt: string | null;
  };
  movements: ApiSapInventoryMovementV1G4[];
  rules: {
    stockSource: 'CANONICAL_INVENTORY_MOVEMENTS';
    sapIdentitySource: 'INTEGRATION_ENTITY_LINKS';
    receipt101Direction: 'IN';
    reversal102Direction: 'OUT';
    issue221Direction: 'OUT';
    reversal222Direction: 'IN';
  };
}

export interface ListSapInventoryV1G4Params {
  workspaceId: string;
  materialId?: string | null;
  warehouseId?: string | null;
  sapMovementType?: ApiSapInventoryMovementTypeV1G4 | null;
  limit?: number;
}
