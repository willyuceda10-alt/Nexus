import React, { useState } from 'react';
import { MeetingsLifecycleV2View } from './MeetingsLifecycleV2View';
import { CanonicalMeetingsCalendarV1 } from './meetingsV1/CanonicalMeetingsCalendarV1';
import { RecurringMeetingsV1Panel } from './meetingsV1/RecurringMeetingsV1Panel';

export const RecurringMeetingsV1View: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const [revision, setRevision] = useState(0);
  const changed = () => setRevision((value) => value + 1);
  return (
    <div className="space-y-4">
      <CanonicalMeetingsCalendarV1 key={`calendar-${revision}`} projectId={projectId} />
      <RecurringMeetingsV1Panel projectId={projectId} onChanged={changed} />
      <MeetingsLifecycleV2View key={`lifecycle-${revision}`} projectId={projectId} />
    </div>
  );
};