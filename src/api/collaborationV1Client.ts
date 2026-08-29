import { request } from './client';
import type {
  ApiObjectCollaborationV1,
  ApiObjectCommentV1,
  CreateObjectCommentV1Input,
  ListObjectCollaborationV1Params,
} from './collaborationV1Contracts';

function collaborationPath(
  objectId: string,
  params: ListObjectCollaborationV1Params = {},
): string {
  const query = new URLSearchParams();
  if (params.commentLimit) query.set('commentLimit', String(params.commentLimit));
  if (params.auditLimit) query.set('auditLimit', String(params.auditLimit));
  if (params.historyLimit) query.set('historyLimit', String(params.historyLimit));
  const suffix = query.toString();
  const base = `/api/v1/objects/${encodeURIComponent(objectId)}/collaboration-v1`;
  return suffix ? `${base}?${suffix}` : base;
}

export const collaborationV1Api = {
  getObjectCollaboration(
    objectId: string,
    params: ListObjectCollaborationV1Params = {},
    signal?: AbortSignal,
  ): Promise<ApiObjectCollaborationV1> {
    return request<ApiObjectCollaborationV1>(collaborationPath(objectId, params), { signal });
  },

  createObjectComment(
    objectId: string,
    input: CreateObjectCommentV1Input,
  ): Promise<ApiObjectCommentV1> {
    return request<ApiObjectCommentV1>(
      `/api/v1/objects/${encodeURIComponent(objectId)}/comments`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },
};
