/**
 * /api/version
 * Lightweight endpoint to confirm exactly which deployed code is running.
 * Returns commit SHA, deployment ID, timestamp, and whether debug capture is present.
 */

const COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';
const DEPLOYMENT_ID = process.env.VERCEL_DEPLOYMENT_ID || 'unknown';
const REGION = process.env.VERCEL_REGION || 'unknown';

// This string will only be present if the debug capture code was compiled into this deployment
const DEBUG_CAPTURE_PRESENT = true; // This line exists only in builds containing the debug capture

export default function handler(req, res) {
  return res.status(200).json({
    commit_sha: COMMIT_SHA,
    deployment_id: DEPLOYMENT_ID,
    region: REGION,
    timestamp: new Date().toISOString(),
    debug_capture_present: DEBUG_CAPTURE_PRESENT,
    node_version: process.version,
  });
}
