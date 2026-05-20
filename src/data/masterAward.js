// src/data/masterAward.js
// Master party wall award template — used as benchmark for award review/comparison

export const MASTER_AWARD_SECTIONS = {
  parties: {
    title: 'The Parties',
    required: ['Building Owner(s) names', 'Address for Service (BO)', 'Adjoining Owner(s) names', 'Address for Service (AO)'],
    notes: 'Must distinguish between Owner and Owners. Addresses for service must be correspondence addresses, not just premise addresses.',
  },
  relevantProperties: {
    title: 'The Relevant Properties',
    required: ['Building Owner\'s Property (premise address)', 'Adjoining Owner\'s Property (premise address)'],
  },
  notices: {
    title: 'The Notices',
    required: ['Notice section reference (e.g. S1, S2, S6)', 'Date of notice service'],
  },
  surveyors: {
    title: 'The Two Surveyors and Third Surveyor',
    required: ['BO Surveyor full name and firm', 'AO Surveyor full name and firm', 'Third Surveyor named or selection mechanism stated'],
    notes: 'Third Surveyor clause must include fallback to Appointing Officer of Local Authority under S10(8) if unable/unwilling to act.',
  },
  whereas: {
    title: 'WHEREAS Recitals',
    required: [
      'BO identified as Building Owner under the Act',
      'AO identified as Adjoining Owner under the Act',
      'Notice service date and section(s) recited',
      'Dispute arisen within meaning of the Act',
      'BO surveyor appointment recited',
      'AO surveyor appointment recited',
      'Third Surveyor selection recited with S10(8) fallback',
      'Surveyors\' jurisdiction to settle by Award recited',
    ],
  },
  generalConditions: {
    title: 'General Conditions (THAT clauses)',
    required: [
      'Award relates only to works described — not wider works outside Act scope',
      'No responsibility implied for structural sufficiency of works',
      'Drawings accepted in good faith',
      'No easement of light affected',
      'Act takes precedence over Award where conflict',
      'S10(17) appeal rights — 14 days to County Court',
      'Works described (ALL_NOTIFIABLE_WORKS)',
      'S7(5) no deviation without surveyor agreement',
    ],
  },
  buildingOwnerObligations: {
    title: 'Building Owner Obligations',
    required: [
      'Works at sole cost and risk of BO',
      'Works in accordance with drawings attached',
      'Protection and support of AO land and buildings',
      'Excavations not open >48 hours, not over weekend, covered in rain',
      'Back-shutter foundation trench at line of junction',
      'Making good damage to AO property — materials to match',
      'Compensation under S7(2)',
      'Services and security systems of AO not affected',
      'Site security maintained — ladders secured when unattended',
      'Access from BO side; 14 days written notice for AO access under S8',
      'No air-bricks, vents, projections over AO property',
      'No surface water drainage onto AO property',
      'Full indemnity to AO for injury/loss/damage',
      'Adequate insurance — evidence on demand',
      'Surveyor access to BO property at all reasonable times',
      'Dust and debris cleared — on completion and on request',
      'Nuisance prevention (smoke, dust, rubbish, vermin)',
      'Statutory fees paid including re AO building',
      'Award contents made known to contractors',
      'Scaffolding cantilevered — not standing on AO property',
      'Scaffold double-boarded with polythene, toe-boards, guard rails, anti-debris sheeting',
      'CISRS certified scaffolding contractor',
      'Temporary weatherproofing on exposure of AO property',
      'Halt works immediately on signs of distress — inform surveyors, structural engineer report required',
      'Flashing in accordance with Lead Sheet Training Academy manual',
      'No materials stored on AO property',
      'Brick matching finished face',
    ],
    optional: [
      'Temporary access to AO garden (hoarding provisions)',
      'S11(11) contribution for enclosure of party wall',
      'Chimney breast removal provisions',
      'Cutting into party wall — hand tools only, max half thickness',
    ],
  },
  temporaryAccess: {
    title: 'Temporary Access Provisions',
    required: [
      '14 days written notice or reasonable in emergency',
      'Duration stated (e.g. 8 weeks)',
      'Robust imperforate hoarding — max 1000mm from boundary',
      'Hoarding not to obstruct doors or windows',
      'AO property within hoarded area suitably protected',
      'No access outside hoarded area',
      'Access via BO rear garden only',
      'No materials stored within hoarded area',
      'Fence panel removal/reinstatement specified',
      'Hoarding removed without delay on completion of flank wall',
      'AO patio reinstated and made good',
    ],
  },
  workingHours: {
    title: 'Working Hours',
    required: [
      'Weekdays 08:00–17:00',
      'Saturdays 09:00–13:00',
      'No Sunday, Bank Holiday or Public Holiday working',
      'BS 5228 compliance (noise and vibration)',
    ],
  },
  costs: {
    title: 'Costs and Fees',
    required: [
      'AO Surveyor costs — sum stated or TBC',
      'AO Surveyor hourly rate for damage/contingencies',
      'Costs payable immediately on serving Award',
    ],
    optional: [
      'Security for Expenses under S12(1) — sum stated, escrow mechanism, solicitor/escrow agent named, release mechanism (two of three surveyors), interest provision',
    ],
  },
  finalClauses: {
    title: 'Final Clauses',
    required: [
      'Surveyors reserve right to make further Awards',
      'CDM 2015 declaration — surveyors have not approved design',
      '12-month commencement clause — void if not commenced within 12 months or ceased for >3 months',
      'No warranty as to sufficiency or design of works',
      'BO to notify surveyors when works sufficiently complete for final inspection',
      'Award does not determine boundary position',
    ],
  },
  documentRegister: {
    title: 'Document Issue Register',
    required: [
      'Works address stated',
      'Adjacent property stated',
      'Schedule of Condition reference with date',
      'All drawings/documents listed',
      'Signed by both surveyors',
    ],
  },
  signatures: {
    title: 'Signatures',
    required: [
      'BO Surveyor signature line with full name and qualifications',
      'AO Surveyor signature line with full name',
      'Award date stated',
    ],
  },
};

export const MASTER_AWARD_TEXT = `PARTY WALL AWARD

THE PARTIES
Building Owner(s): [name(s)] | Address for Service: [address]
Adjoining Owner(s): [name(s)] | Address for Service: [address]

THE RELEVANT PROPERTIES
Building Owner's Property: [premise address]
Adjoining Owner's Property: [premise address]

THE NOTICES
Notices under section [section(s)] dated [date]

THE PRINCIPAL AWARD
This Award dated [date]

THE TWO SURVEYORS
Building Owner's Surveyor: Itzik Darel MIPWS ACIArb of Square One Consulting, Suite 28, 708A High Road, London, N12 9QL
Adjoining Owner's Surveyor: [name] of [firm]

THIRD SURVEYOR: [name] — with S10(8) fallback to Appointing Officer of Local Authority

WHEREAS RECITALS
- BO identified as Building Owner under the Act
- AO identified as Adjoining Owner under the Act
- Notice dated [date] served under sections [sections]
- Dispute arisen within meaning of the Act
- BO surveyor appointment confirmed
- AO surveyor appointment confirmed
- Third Surveyor selected with S10(8) fallback
- Surveyors' jurisdiction to settle by Award recited

KEY CLAUSES (all required unless works-specific):
1. Award scope limited to works described — no wider scope
2. No structural responsibility implied on surveyors
3. Drawings accepted in good faith
4. No easement of light affected
5. Act takes precedence over Award
6. S10(17) appeal rights — 14 days to County Court
7. Works description (notifiable works listed)
8. S7(5) no deviation without surveyor agreement
9. BO obligations: sole cost/risk, drawings compliance, protection, excavation rules,
   making good, S7(2) compensation, services, security, S8 access notice,
   no projections over AO, no surface water, indemnity, insurance,
   surveyor access, dust/debris, nuisance, statutory fees, award to contractors
10. Working hours: 08:00–17:00 weekdays, 09:00–13:00 Saturdays, no Sunday/BH
11. BS 5228 compliance
12. AO surveyor costs — sum + hourly rate for contingencies
13. Security for Expenses S12(1) — escrow, two-of-three release
14. CDM 2015 declaration
15. 12-month void clause
16. No warranty as to sufficiency/design
17. Final inspection notification obligation
18. No boundary determination
19. Document Issue Register — signed by both surveyors`;

export const AWARD_REVIEW_SYSTEM_PROMPT = `You are reviewing a party wall award against a master benchmark template.

MASTER BENCHMARK SECTIONS AND REQUIREMENTS:
${JSON.stringify(MASTER_AWARD_SECTIONS, null, 2)}

YOUR TASK:
Analyse the uploaded award and produce a structured review covering:

1. MISSING CLAUSES — important clauses in the master that are absent from this award
2. WEAKER WORDING — clauses present but with weaker or less complete wording than the master
3. IMPROVEMENTS — specific wording from the master (or best practice) that would strengthen this award
4. WHAT THIS AWARD HAS THAT THE MASTER LACKS — any additions that are valid and worth noting
5. CRITICAL ISSUES — anything legally problematic or missing that must be addressed before service

Be specific. Quote the exact clause or wording that is missing or weaker. Reference section numbers from the Act where relevant.

Format your response clearly with these five sections. Be direct — this is a professional review for a practising party wall surveyor.`;
