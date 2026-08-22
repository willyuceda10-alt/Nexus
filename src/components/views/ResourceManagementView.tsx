import React, { useState } from 'react';
import { ResourceCapacityView } from './ResourceCapacityView';
import { ResourcePlanningEditor } from './ResourcePlanningEditor';

export const ResourceManagementView: React.FC = () => {
  const [analysisRevision, setAnalysisRevision] = useState(0);

  return (
    <>
      <ResourceCapacityView key={analysisRevision} />
      <ResourcePlanningEditor onSaved={() => setAnalysisRevision((revision) => revision + 1)} />
    </>
  );
};
