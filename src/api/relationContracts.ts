export type ApiGenericRelationType =
  | 'BLOCKS'
  | 'DERIVED_FROM'
  | 'RELATES_TO'
  | 'MITIGATES'
  | 'REQUIRES_APPROVAL';

export interface ApiGenericRelation {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  relationType: ApiGenericRelationType;
  notes: string | null;
  createdAt: string;
}

export interface ApiGenericRelationListResponse {
  items: ApiGenericRelation[];
}

export interface CreateApiGenericRelationInput {
  sourceObjectId: string;
  targetObjectId: string;
  relationType: ApiGenericRelationType;
  notes?: string;
}
