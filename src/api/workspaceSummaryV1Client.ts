import { request } from './client';

export interface WorkspaceSummaryV1 {
  workspaceId: string;
  totalObjects: number;
  projects: {
    total: number;
    active: number;
    completed: number;
    averageProgress: number;
  };
  work: {
    open: number;
    mine: number;
    blocked: number;
    attention?: number;
    overdue: number;
    dueNext14Days: number;
  };
  risk: {
    critical: number;
  };
  approvals: {
    pending: number;
  };
  generatedAt: string;
}

export const workspaceSummaryV1Api = {
  get(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceSummaryV1> {
    return request<WorkspaceSummaryV1>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/summary-v1`,
      { signal },
    );
  },
};
