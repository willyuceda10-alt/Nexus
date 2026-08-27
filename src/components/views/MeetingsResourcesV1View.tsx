import React from 'react';
import { MeetingResourcesPanelV1 } from './meetingsV1/MeetingResourcesPanelV1';
import { MeetingsDecisionsV2View } from './MeetingsDecisionsV2View';

export const MeetingsResourcesV1View: React.FC<{ projectId?: string }> = ({ projectId }) => (
  <div className="space-y-4">
    <div className="mx-auto w-full max-w-[1540px] px-5 pt-5 lg:px-7">
      <MeetingResourcesPanelV1 projectId={projectId} />
    </div>
    <MeetingsDecisionsV2View projectId={projectId} />
  </div>
);
