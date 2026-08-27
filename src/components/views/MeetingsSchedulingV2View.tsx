import React, { useState } from 'react';
import { MeetingSchedulingV2Panel } from './meetingsV1/MeetingSchedulingV2Panel';
import { MeetingsResourcesV1View } from './MeetingsResourcesV1View';

export const MeetingsSchedulingV2View: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const [revision, setRevision] = useState(0);
  return (
    <div className="space-y-4">
      <MeetingSchedulingV2Panel projectId={projectId} onScheduled={() => setRevision((value) => value + 1)} />
      <MeetingsResourcesV1View key={revision} projectId={projectId} />
    </div>
  );
};
