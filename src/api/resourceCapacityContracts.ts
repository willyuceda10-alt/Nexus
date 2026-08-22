export interface ApiResourceCapacityWeek {
  weekStart: string;
  capacityHours: number;
  allocatedHours: number;
  utilizationPct: number;
  overallocatedHours: number;
}

export interface ApiResourceCapacityAssignment {
  objectId: string;
  title: string;
  projectId?: string;
  effortHours?: number;
  allocatedHoursInRange: number;
  startDate?: string;
  dueDate?: string;
  sized: boolean;
  scheduled: boolean;
}

export interface ApiResourceCapacityResource {
  resourceId: string;
  linkedUserId?: string;
  name: string;
  capacityHoursPerDay: number;
  capacityHours: number;
  allocatedHours: number;
  utilizationPct: number;
  overallocatedHours: number;
  unsizedItems: number;
  unscheduledItems: number;
  weeks: ApiResourceCapacityWeek[];
  assignments: ApiResourceCapacityAssignment[];
}

export interface ApiResourceCapacityResponse {
  method: 'EFFORT_DISTRIBUTION_V1';
  generatedAt: string;
  workspaceId: string;
  range: { from: string; to: string };
  profileCount: number;
  assignmentCount: number;
  from: string;
  to: string;
  resources: ApiResourceCapacityResource[];
  unprofiledAssignments: number;
  unprofiledSizedHours: number;
}
