import React, { useState } from 'react';
import { MeetingLifecycleV2Panel } from './meetingsV1/MeetingLifecycleV2Panel';
import { MeetingsSchedulingV2View } from './MeetingsSchedulingV2View';

export const MeetingsLifecycleV2View: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const [revision, setRevision] = useState(0);
  return (
    <div className="space-y-4">
      <MeetingLifecycleV2Panel projectId={projectId} onChanged={() => setRevision((value) => value + 1)} />
      <MeetingsSchedulingV2View key={revision} projectId={projectId} />
    </div>
  );
};
