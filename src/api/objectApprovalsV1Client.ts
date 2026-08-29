import { request } from './client';
import type {
  ApiEligibleApproversResponseV1,
  ApiObjectApprovalListV1,
  CancelObjectApprovalV1Input,
  CreateObjectApprovalV1Input,
  DecideObjectApprovalV1Input,
  ObjectApprovalMutationResponseV1,
} from './objectApprovalsV1Contracts';

export const objectApprovalsV1Api = {
  list(objectId: string, signal?: AbortSignal): Promise<ApiObjectApprovalListV1> {
    const query = new URLSearchParams({ objectId, limit: '100' });
    return request<ApiObjectApprovalListV1>(`/api/v1/object-approvals-v1?${query.toString()}`, { signal });
  },

  eligibleApprovers(objectId: string, signal?: AbortSignal): Promise<ApiEligibleApproversResponseV1> {
    const query = new URLSearchParams({ objectId });
    return request<ApiEligibleApproversResponseV1>(
      `/api/v1/object-approvals-v1/eligible-approvers?${query.toString()}`,
      { signal },
    );
  },

  create(input: CreateObjectApprovalV1Input): Promise<ObjectApprovalMutationResponseV1> {
    return request<ObjectApprovalMutationResponseV1>('/api/v1/object-approvals-v1', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  decide(id: string, input: DecideObjectApprovalV1Input): Promise<ObjectApprovalMutationResponseV1> {
    return request<ObjectApprovalMutationResponseV1>(
      `/api/v1/object-approvals-v1/${encodeURIComponent(id)}/decision`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },

  cancel(id: string, input: CancelObjectApprovalV1Input = {}): Promise<ObjectApprovalMutationResponseV1> {
    return request<ObjectApprovalMutationResponseV1>(
      `/api/v1/object-approvals-v1/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },
};
