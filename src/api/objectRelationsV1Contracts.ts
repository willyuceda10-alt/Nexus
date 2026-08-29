export type ApiObjectRelationTypeV1 =
  | 'BLOCKS'
  | 'DEPENDS_ON'
  | 'DERIVED_FROM'
  | 'RELATES_TO'
  | 'MITIGATES'
  | 'REQUIRES_APPROVAL';

export interface ApiObjectRelationV1 {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  relationType: ApiObjectRelationTypeV1;
  notes: string | null;
  createdAt: string;
}

export interface ApiObjectRelationListV1 {
  items: ApiObjectRelationV1[];
}

export interface CreateApiObjectRelationV1Input {
  sourceObjectId: string;
  targetObjectId: string;
  relationType: Exclude<ApiObjectRelationTypeV1, 'DEPENDS_ON'>;
  notes?: string;
}
