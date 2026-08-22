import React from 'react';
import { useProjectForecast } from '../../hooks/useProjectForecast';
import { ForecastSummary } from './ForecastSummary';
import { GanttView } from './GanttView';

export const ProjectGanttSection: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { forecast, loading, error } = useProjectForecast(projectId);

  return (
    <>
      <ForecastSummary forecast={forecast} loading={loading} error={error} />
      <GanttView projectId={projectId} forecast={forecast} />
    </>
  );
};
