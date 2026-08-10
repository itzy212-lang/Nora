const required = ['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','OPENAI_API_KEY','MEDIATION_SUPABASE_URL','MEDIATION_SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'feature/phoenix-mediation-foundation') {
  console.log('[phoenix-regression] skipped outside Phoenix preview');
  process.exit(0);
}
if (missing.length) throw new Error(`[phoenix-regression] missing env: ${missing.join(', ')}`);
const { runStressSimulation } = await import('../api/mediation/run-stress-simulation.js');
console.log('[phoenix-regression] starting Hazelwood two-party Terra simulation with Phoenix dynamic conversation engine');
const result = await runStressSimulation({ force: true });
const a = result.partyA?.transcript?.length || 0;
const b = result.partyB?.transcript?.length || 0;
console.log(`[phoenix-regression] complete: Party A=${a} turns, Party B=${b} turns stored`);
