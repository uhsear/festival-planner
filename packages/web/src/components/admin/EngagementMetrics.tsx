import React from 'react';

export interface EngagementMetricsProps {
  avgPicksPerUser: number;
  avgCrewSize: number;
  crewParticipation: number;
}

export default function EngagementMetrics({
  avgPicksPerUser,
  avgCrewSize,
  crewParticipation,
}: EngagementMetricsProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-text-primary mb-4">Engagement Metrics</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
          <div className="text-sm text-text-muted mb-1">Avg Picks per User</div>
          <div className="text-2xl font-bold text-text-primary">{avgPicksPerUser.toFixed(1)}</div>
        </div>
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
          <div className="text-sm text-text-muted mb-1">Avg Crew Size</div>
          <div className="text-2xl font-bold text-text-primary">{avgCrewSize.toFixed(1)}</div>
        </div>
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
          <div className="text-sm text-text-muted mb-1">Crew Participation</div>
          <div className="text-2xl font-bold text-text-primary">{(crewParticipation * 100).toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}
