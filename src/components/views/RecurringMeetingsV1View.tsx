import React, { useState } from 'react';
import { MeetingsLifecycleV2View } from './MeetingsLifecycleV2View';
import { RecurringMeetingsV1Panel } from './meetingsV1/RecurringMeetingsV1Panel';

export const RecurringMeetingsV1View: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const [revision, setRevision] = useState(0);
  return (
    <div className="space-y-4">
      <RecurringMeetingsV1Panel projectId={projectId} onChanged={() => setRevision((value) => value + 1)} />
      <MeetingsLifecycleV2View key={revision} projectId={projectId} />
    </div>
  );
};
