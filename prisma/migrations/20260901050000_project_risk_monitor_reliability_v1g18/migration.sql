CREATE TABLE IF NOT EXISTS project_risk_monitor_runtime_v1g18 (
    lease_key TEXT PRIMARY KEY,
    holder_id UUID,
    acquired_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,

    last_started_at TIMESTAMPTZ,
    last_completed_at TIMESTAMPTZ,

    last_status TEXT,
    last_duration_ms BIGINT,
    last_summary JSONB,

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT project_risk_monitor_runtime_v1g18_status_check
        CHECK (
            last_status IS NULL
            OR last_status IN (
                'SUCCESS',
                'PARTIAL',
                'FAILED',
                'SKIPPED_LOCKED'
            )
        ),

    CONSTRAINT project_risk_monitor_runtime_v1g18_duration_check
        CHECK (
            last_duration_ms IS NULL
            OR last_duration_ms >= 0
        )
);

COMMENT ON TABLE project_risk_monitor_runtime_v1g18 IS
'Internal platform runtime state for the scheduled project risk monitor. No tenant business data is stored here.';

COMMENT ON COLUMN project_risk_monitor_runtime_v1g18.expires_at IS
'Crash-safe distributed lease expiry. The active holder refreshes this value through heartbeat.';

CREATE INDEX IF NOT EXISTS
    project_risk_monitor_runtime_v1g18_expires_idx
ON project_risk_monitor_runtime_v1g18 (
    expires_at
);
