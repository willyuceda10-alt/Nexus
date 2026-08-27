export interface ApiMaterialMasterV2 {
  id: string;
  materialObjectId: string;
  code: string;
  title: string;
  baseUomId: string;
  uomCode: string;
  uomName: string;
  unitCost: number;
  currency: string;
  isActive: boolean;
}

export interface ApiWarehouseV2 {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface ApiSupplierV2 {
  id: string;
  code: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface ApiUomV2 {
  id: string;
  code: string;
  name: string;
  decimal_places: number;
}

export interface ApiMaterialSetupV2 {
  workspaceId: string;
  uoms: ApiUomV2[];
  materials: ApiMaterialMasterV2[];
  warehouses: ApiWarehouseV2[];
  suppliers: ApiSupplierV2[];
}

export type ApiMaterialSupplyStateV2 =
  | 'FULFILLED'
  | 'RESERVED'
  | 'AVAILABLE'
  | 'ON_ORDER'
  | 'LATE'
  | 'SHORTAGE';
export type ApiMaterialRiskLevelV2 = 'NONE' | 'WATCH' | 'HIGH' | 'CRITICAL';

export interface ApiMaterialRequirementRiskV2 {
  id: string;
  projectId: string;
  projectTitle: string;
  workItemId: string | null;
  workItemTitle: string | null;
  wbsCode: string | null;
  materialId: string;
  materialObjectId: string;
  materialCode: string;
  materialTitle: string;
  uomCode: string;
  preferredWarehouseId: string | null;
  warehouseName: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: string;
  notes: string | null;
  requiredQty: number;
  issuedQty: number;
  remainingQty: number;
  onHandQty: number;
  reservedQty: number;
  competingReservedQty: number;
  availableQty: number;
  onOrderQty: number;
  projectedQty: number;
  deficitQty: number;
  projectedAvailabilityDate: string | null;
  requiredDate: string;
  lateByDays: number;
  state: ApiMaterialSupplyStateV2;
  riskLevel: ApiMaterialRiskLevelV2;
  taskAtRisk: boolean;
  purchaseOrders: Array<{
    id: string;
    number: string;
    outstandingQty: number;
    expectedDate: string | null;
  }>;
}

export interface ApiInventoryStockV2 {
  materialId: string;
  materialCode: string;
  materialTitle: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
}

export interface ApiMaterialOverviewV2 {
  workspaceId: string;
  projectId: string | null;
  asOf: string;
  summary: {
    requirementCount: number;
    atRiskCount: number;
    criticalCount: number;
    shortageCount: number;
    taskAtRiskCount: number;
    totalDeficitQty: number;
    openPurchaseOrderCount: number;
  };
  taskRiskIds: string[];
  requirements: ApiMaterialRequirementRiskV2[];
  stock: ApiInventoryStockV2[];
}

export interface CreateMaterialRequirementV2Input {
  workspaceId: string;
  projectId: string;
  workItemId?: string | null;
  materialId: string;
  preferredWarehouseId?: string | null;
  requiredQty: number;
  requiredDate: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  notes?: string | null;
}

export interface CreateReservationV2Input {
  requirementId: string;
  warehouseId: string;
  quantity: number;
}

export interface CreatePurchaseOrderV2Input {
  workspaceId: string;
  projectId?: string | null;
  supplierId: string;
  number: string;
  orderDate?: string;
  expectedDate?: string | null;
  currency?: string;
  notes?: string | null;
  lines: Array<{
    materialId: string;
    requirementId?: string | null;
    uomId: string;
    quantity: number;
    unitCost?: number;
    expectedDate?: string | null;
  }>;
}

export interface CreateGoodsReceiptV2Input {
  workspaceId: string;
  warehouseId: string;
  purchaseOrderId?: string | null;
  number: string;
  receivedAt?: string;
  notes?: string | null;
  lines: Array<{
    purchaseOrderLineId?: string | null;
    materialId: string;
    requirementId?: string | null;
    uomId: string;
    quantity: number;
    unitCost?: number;
  }>;
}

export interface CreateMaterialIssueV2Input {
  workspaceId: string;
  warehouseId: string;
  materialId: string;
  requirementId?: string | null;
  workItemId?: string | null;
  quantity: number;
  unitCost?: number;
  occurredAt?: string;
  notes?: string | null;
}

export interface MaterialEngineBackfillV2Response {
  dryRun: boolean;
  totalMaterialObjects: number;
  planned: number;
  created: number;
}
