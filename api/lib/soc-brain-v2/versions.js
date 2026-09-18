// api/lib/soc-brain-v2/versions.js
//
// Nora SOC v2 — central version registry (Master Instructions §38,
// Pipeline & Reconciliation Spec §29).
//
// Built Phase B. Every SOC v2 logical component's version is tracked
// in one place, so a generation record can state exactly which
// versions produced it, and so future changes to any one component
// are identifiable rather than silent.
//
// Not yet consumed by the live generation path — soc_reports.brain_versions
// (added this phase) stays null until the v2 drafting/audit stages
// actually run (Phase F onward). Importing SOC_V2_VERSIONS at that point
// and writing it into that column is the intended usage.

import { UNIVERSAL_SOC_BRAIN_VERSION } from './universal-soc-brain.js';
import { USER_SOC_BRAIN_VERSION } from './user-soc-brain.js';

export const SOC_V2_VERSIONS = {
  universal_soc_brain: UNIVERSAL_SOC_BRAIN_VERSION,
  user_soc_brain: USER_SOC_BRAIN_VERSION,
  inspection_state_contract: 'v1.0.0',
  // Not yet implemented as running components — versions reserved here
  // now so the shape of a generation record's provenance is stable
  // from the start, rather than added piecemeal as each stage is built.
  reconciliation_contract: null,
  drafting_contract: null,
  fidelity_audit: null,
  quality_audit: null,
};
