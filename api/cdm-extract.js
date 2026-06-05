// CDM 2015 Variable Extractor - Nora API
// Receives pre-extracted document text from cdm-build
// Just calls Claude and returns structured JSON - no file parsing here

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const CDM_VARIABLES = [
  'PROJECT_DESCRIPTION','PROJECT_DESCRIPTION_FULL','PROGRAMME_DURATION',
  'PROJECT_START_DATE','SITE_ADDRESS_FULL','SITE_POSTCODE',
  'CLIENT_NAME','CLIENT_ADDRESS','CLIENT_CONTACT_NAME','CLIENT_PHONE','CLIENT_EMAIL',
  'CONTRACT_ADMIN_COMPANY','CONTRACT_ADMIN_ADDRESS','CONTRACT_ADMIN_CONTACT',
  'CONTRACT_ADMIN_PHONE','CONTRACT_ADMIN_EMAIL',
  'STRUCTURAL_ENGINEER_COMPANY','STRUCTURAL_ENGINEER_ADDRESS','STRUCTURAL_ENGINEER_CONTACT',
  'STRUCTURAL_ENGINEER_PHONE','STRUCTURAL_ENGINEER_EMAIL',
  'PRINCIPAL_CONTRACTOR_COMPANY','PRINCIPAL_CONTRACTOR_ADDRESS','PRINCIPAL_CONTRACTOR_CONTACT',
  'PRINCIPAL_CONTRACTOR_PHONE','PRINCIPAL_CONTRACTOR_EMAIL',
  'ME_CONSULTANT','BUILDING_CONTROL_BODY','LOCAL_AUTHORITY_NAME',
  'LOCAL_AUTHORITY_ADDRESS','LOCAL_AUTHORITY_PHONE',
  'EXISTING_STRUCTURES_DESCRIPTION','EXISTING_RECORDS_DESCRIPTION',
  'ELECTRICAL_SUPPLY_DETAILS','WATER_SUPPLY_DETAILS','GAS_SUPPLY_DETAILS',
  'HISTORICAL_USE_DESCRIPTION','LISTED_BUILDING_STATUS','SITE_INVESTIGATION_REPORTS',
  'CONTAMINATION_GROUND_CONDITIONS','STRUCTURAL_DESCRIPTION',
  'SURROUNDING_AREA_DESCRIPTION','ACCESS_EGRESS_DESCRIPTION','PARKING_DESCRIPTION',
  'DELIVERY_HOURS','DELIVERY_ROUTE_DESCRIPTION',
  'RESIDUAL_HAZARDS_DESCRIPTION','HAZARDOUS_MATERIALS_DESCRIPTION',
  'RA_BRICK_BLOCK','RA_CARPENTRY','RA_CONFINED_SPACE','RA_CONTAMINATED_LAND',
  'RA_DEMOLITION','RA_TEMPORARY_ELECTRICS','RA_EXCAVATION','RA_FALSEWORK',
  'RA_HOISTS','RA_HOUSEKEEPING','RA_LIGHTING','RA_MANUAL_HANDLING',
  'RA_MOBILE_PLANT','RA_OVERHEAD_CABLES','RA_PERCUSSIVE_TOOLS',
  'RA_UNDERGROUND_SERVICES','RA_WORK_AT_HEIGHT','RA_COSHH',
  'RA_WORKING_NEAR_WATER','RA_GENERAL_BUILDING','RA_PILING',
  'RA_REFURB_OCCUPIED','RA_ASBESTOS',
]

const SYSTEM_PROMPT = `You are a CDM 2015 Construction Phase Health and Safety Plan specialist.
Extract specific variables from the construction project documents provided.

RULES:
1. Extract only what is explicitly stated. Never invent or assume.
2. RA_ variables: "Yes" if activity applies or uncertain, "No" only if clearly irrelevant.
3. Null for anything not found.
4. SITE ADDRESS: Look on the cover page/header of every document. Extract as SITE_ADDRESS_FULL and SITE_POSTCODE.
5. CLIENT NAME: Look for "Client:", "Instructing Party:", "Prepared for:", "Client Name and Address:" in any document.
6. CONTRACT ADMIN: Look for architect/project manager in drawings. Often the practice that produced the drawings.
7. STRUCTURAL ENGINEER: Any engineering firm in structural drawings or reports.
8. EXISTING STRUCTURES: Describe the building - age, floors, construction type from survey docs.
9. ASBESTOS: If an asbestos refurbishment survey is present, always set RA_ASBESTOS="Yes". Note the survey in SITE_INVESTIGATION_REPORTS.
10. LISTED BUILDING: Look for listed building status or conservation area mentions.
11. LOCAL AUTHORITY: Identify from site postcode or any planning references in documents.

RA LOGIC:
- RA_BRICK_BLOCK: Yes if brickwork/blockwork/masonry mentioned
- RA_CARPENTRY: Yes if timber/joinery/roof structure/studwork mentioned
- RA_CONFINED_SPACE: Yes only if explicitly required
- RA_CONTAMINATED_LAND: Yes only if contamination identified
- RA_DEMOLITION: Yes if demolition/strip out/removal of structure mentioned
- RA_TEMPORARY_ELECTRICS: Yes for almost all projects
- RA_EXCAVATION: Yes if groundworks/foundations/excavation mentioned
- RA_FALSEWORK: Yes if propping/shoring/temporary support mentioned
- RA_HOISTS: Yes only if explicitly required
- RA_HOUSEKEEPING: Yes for all projects
- RA_LIGHTING: Yes for all projects
- RA_MANUAL_HANDLING: Yes for all projects
- RA_MOBILE_PLANT: Yes if plant/machinery/vehicles on site
- RA_OVERHEAD_CABLES: Yes only if identified near site
- RA_PERCUSSIVE_TOOLS: Yes if breaking/drilling mentioned
- RA_UNDERGROUND_SERVICES: Yes for almost all projects with groundworks
- RA_WORK_AT_HEIGHT: Yes if work above ground/roof/scaffold/ladders
- RA_COSHH: Yes for all projects with chemicals/dust/solvents
- RA_WORKING_NEAR_WATER: Yes only if site is near water
- RA_GENERAL_BUILDING: Yes for all projects
- RA_PILING: Yes only if explicitly mentioned
- RA_REFURB_OCCUPIED: Yes only if works in occupied building
- RA_ASBESTOS: Yes if pre-2000 building or asbestos survey mentioned

Return ONLY a valid JSON object. No markdown, no preamble, no explanation.`

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!ANTHROPIC_KEY) {
    console.error('[cdm-extract] ANTHROPIC_API_KEY is not set')
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on this server' })
  }

  try {
    const { document_text, project_id, company_profile = {} } = req.body || {}

    if (!document_text) {
      return res.status(400).json({ error: 'No document_text provided' })
    }

    console.log(`[cdm-extract] project=${project_id} text_length=${document_text.length}`)

    const variableList = CDM_VARIABLES.join('\n')
    const userMessage = `Extract these variables from the construction documents below.\n\nVARIABLES:\n${variableList}\n\nDOCUMENTS:\n${document_text}\n\nReturn ONLY the JSON object.`

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!apiRes.ok) {
      const errBody = await apiRes.text()
      console.error('[cdm-extract] Anthropic error:', apiRes.status, errBody)
      return res.status(500).json({ error: `Anthropic API error ${apiRes.status}: ${errBody}` })
    }

    const apiData = await apiRes.json()
    const rawText = apiData.content?.[0]?.text || ''
    console.log('[cdm-extract] Claude raw response length:', rawText.length)

    let extracted
    try {
      const clean = rawText.replace(/```json/g, '').replace(/```/g, '').trim()
      extracted = JSON.parse(clean)
    } catch (e) {
      console.error('[cdm-extract] JSON parse failed. Raw:', rawText.slice(0, 300))
      return res.status(500).json({ error: 'Claude returned invalid JSON', raw: rawText.slice(0, 300) })
    }

    // Merge company profile
    const merged = { ...extracted }
    if (company_profile.company_name) merged.PRINCIPAL_CONTRACTOR_COMPANY = company_profile.company_name
    if (company_profile.company_address) merged.PRINCIPAL_CONTRACTOR_ADDRESS = company_profile.company_address
    if (company_profile.company_phone) merged.PRINCIPAL_CONTRACTOR_PHONE = company_profile.company_phone
    if (company_profile.company_email) merged.PRINCIPAL_CONTRACTOR_EMAIL = company_profile.company_email
    if (company_profile.contracts_director_name) merged.CONTRACTS_DIRECTOR_NAME = company_profile.contracts_director_name
    if (company_profile.project_manager_name) merged.PROJECT_MANAGER_NAME = company_profile.project_manager_name
    if (company_profile.site_manager_name) merged.SITE_MANAGER_NAME = company_profile.site_manager_name

    const missing = [], found = [], raVariables = []
    CDM_VARIABLES.forEach(key => {
      if (key.startsWith('RA_')) {
        raVariables.push({ key, value: merged[key] || 'Yes' })
      } else if (!merged[key]) {
        missing.push(key)
      } else {
        found.push(key)
      }
    })

    const checklist = [
      { key: 'HOSPITAL_MAP_IMAGE', label: 'Hospital route map image', section: '1.2', required: true },
      { key: 'APPENDIX_A_SITE_LOGISTICS', label: 'Site logistics plan drawing', section: 'Appendix A', required: true },
      { key: 'APPENDIX_B_PHOTOS', label: 'Site photographs', section: 'Appendix B', required: false },
      { key: 'APPENDIX_C_PROGRAMME', label: 'Programme of works / Gantt chart', section: 'Appendix C', required: true },
      { key: 'APPENDIX_F_TRAFFIC_PLAN', label: 'Traffic management plan', section: 'Appendix F', required: true },
      { key: 'STATEMENT_SIGNATURES', label: 'Signed statement of commitment page', section: 'Statement page', required: true },
    ]
    if (merged.RA_ASBESTOS === 'Yes') checklist.push({ key: 'APPENDIX_H_ASBESTOS', label: 'Asbestos survey report', section: 'Appendix H', required: true })
    if (merged.RA_HOISTS === 'Yes') checklist.push({ key: 'APPENDIX_G_LIFTING_PLAN', label: 'Construction lifting plan', section: 'Appendix G', required: true })

    console.log(`[cdm-extract] Done. found=${found.length} missing=${missing.length}`)

    return res.status(200).json({
      success: true,
      extracted: merged,
      missing,
      found,
      ra_variables: raVariables,
      completion_checklist: checklist,
      text_length: document_text.length,
    })

  } catch (err) {
    console.error('[cdm-extract] unhandled error:', err)
    return res.status(500).json({ error: err.message || 'CDM extraction failed', success: false })
  }
}
