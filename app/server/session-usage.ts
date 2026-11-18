const HEARTBEAT_GRACE_MS = 3000;

type SessionMetadata = {
  realtime_credential_issued_at?: string;
  first_output_at?: string;
  last_heartbeat?: string;
};

export function firstOutputTime(metadata: SessionMetadata) {
  const credentialIssued = Date.parse(metadata.realtime_credential_issued_at ?? '');
  // Older sessions only recorded their latest output heartbeat.
  const firstOutput = Date.parse(metadata.first_output_at ?? metadata.last_heartbeat ?? '');
  return Math.max(credentialIssued, firstOutput);
}

export function settledSessionUsage(metadata: SessionMetadata, now: number) {
  const start = firstOutputTime(metadata);
  const heartbeat = Date.parse(metadata.last_heartbeat ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(heartbeat)) {
    return { seconds: 0, endTime: now };
  }
  const endTime = Math.min(now, heartbeat + HEARTBEAT_GRACE_MS);
  return { seconds: Math.max(0, Math.floor((endTime - start) / 1000)), endTime };
}
