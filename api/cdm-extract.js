import fetch from 'node-fetch';

// CDM 2015 Construction Phase H&S Plan - Variable Extractor
// Uses Anthropic Claude to read uploaded project documents
// and extract the 65 variables needed to generate a CDM plan
// Called by cdm-build via API

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CDM_VARIABLES = [
  'PROJECT_DESCRIPTION', 'PROJECT_DESCRIPTION_FULL', 'PROGRAMME_DURATION',
  'PROJECT_START_DATE', 'SITE_ADDRESS_FULL', 'SITE_POSTCODE',
  'CLIENT_NAME', 'CLIENT_ADDRESS', 'CLIENT_CONTACT_NAME', 'CLIENT_PHONE', 'CLIENT_EMAIL',
  'CONTRACT_ADMIN_COMPANY', 'CONTRACT_ADMIN_ADDRESS', 'CONTRACT_ADMIN_CONTACT',
  'CONTRACT_ADMIN_PHONE', 'CONTRACT_ADMIN_EMAIL',
  'STRUCTURAL_ENGINEER_COMPANY', 'STRUCTURAL_ENGINEER_ADDRESS', 'STRUCTURAL_ENGINEER_CONTACT',
  'STRUCTURAL_ENGINEER_PHONE', 'STRUCTURAL_ENGINEER_EMAIL',
  'PRINCIPAL_CONTRACTOR_COMPANY', 'PRINCIPAL_CONTRACTOR_ADDRESS', 'PRINCIPAL_CONTRACTOR_CONTACT',
  'PRINCIPAL_CONTRACTOR_PHONE', 'PRINCIPAL_CONTRACTOR_EMAIL',
  'ME_CONSULTANT', 'BUILDING_CONTROL_BODY', 'LOCAL_AUTHORITY_NAME',
  'LOCAL_AUTHORITY_ADDRESS', 'LOCAL_AUTHORITY_PHONE',
  'EXISTING_STRUCTURES_DESCRIPTION', 'EXISTING_RECORDS_DESCRIPTION',
  'ELECTRICAL_SUPPLY_DETAILS', 'WATER_SUPPLY_DETAILS', 'GAS_SUPPLY_DETAILS',
  'HISTORICAL_USE_DESCRIPTION', 'LISTED_BUILDING_STATUS', 'SITE_INVESTIGATION_REPORTS',
  'CONTAMINATION_GROUND_CONDITIONS', 'STRUCTURAL_DESCRIPTION',
  'SURROUNDING_AREA_DESCRIPTION', 'ACCESS_EGRESS_DESCRIPTION', 'PARKING_DESCRIPTION',
  'DELIVERY_HOURS', 'DELIVERY_ROUTE_DESCRIPTION',
  'RESIDUAL_HAZARDS_DESCRIPTION', 'HAZARDOUS_MATERIALS_DESCRIPTION',
  'RA_BRICK_BLOCK', 'RA_CARPENTRY', 'RA_CONFINED_SPACE', 'RA_CONTAMINATED_LAND',
  'RA_DEMOLITION', 'RA_TEMPORARY_ELECTRICS', 'RA_EXCAVATION', 'RA_FALSEWORK',
  'RA_HOISTS', 'RA_HOUSEKEEPING', 'RA_LIGHTING', 'RA_MANUAL_HANDLING',
  'RA_MOBILE_PLANT', 'RA_OVERHEAD_CABLES', 'RA_PERCUSSIVE_TOOLS',
  'RA_UNDERGROUND_SERVICES', 'RA_WORK_AT_HEIGHT', 'RA_COSHH',
  'RA_WORKING_NEAR_WATER', 'RA_GENERAL_BUILDING', 'RA_PILING',
  'RA_REFURB_OCCUPIED', 'RA_ASBESTOS',
]

const CDM_SYSTEM_PROMPT = `
You are an expert CDM 2015 Construction Phase Health and Safety Plan specialist with deep knowledge of:
- The Construction (Design and Management) Regulations 2015
- UK construction industry practice and terminology
- Health and safety risk assessment methodology
- Structural engineering documentation
- Architectural drawings and specifications
- Building regulations and compliance

Your task is to read construction project documents and extract specific information needed to generate a CDM 2015 compliant Construction Phase Health and Safety Plan.

EXTRACTION RULES:
1. Extract only what is explicitly stated in the documents. Never invent or assume information.
2. For risk assessments (RA_ variables), set to "Yes" if the scope of works includes that activity, "No" if it clearly does not apply, and "Yes" if uncertain — it is always safer to include.
3. For addresses, extract the full formatted address including postcode where available.
4. For names, extract full names including titles where given.
5. For phone numbers, extract exactly as written.
6. If information is not found, set the value to null — do not guess.

RISK ASSESSMENT LOGIC:
- RA_BRICK_BLOCK: Yes if any brickwork, blockwork or masonry mentioned
- RA_CARPENTRY: Yes if any timber work, joinery, roof structure, studwork or carpentry mentioned
- RA_CONFINED_SPACE: Yes only if confined space working explicitly required
- RA_CONTAMINATED_LAND: Yes only if contamination identified
- RA_DEMOLITION: Yes if any demolition, strip out or removal of structure mentioned
- RA_TEMPORARY_ELECTRICS: Yes for almost all construction projects
- RA_EXCAVATION: Yes if any groundworks, foundations or excavation mentioned
- RA_FALSEWORK: Yes if any propping, shoring or temporary structural support mentioned
- RA_HOISTS: Yes only if goods or passenger hoists explicitly required
- RA_HOUSEKEEPING: Yes for all projects
- RA_LIGHTING: Yes for all projects
- RA_MANUAL_HANDLING: Yes for all projects
- RA_MOBILE_PLANT: Yes if any plant, machinery or vehicles on site
- RA_OVERHEAD_CABLES: Yes only if overhead cables identified near site
- RA_PERCUSSIVE_TOOLS: Yes if any breaking, drilling or percussive work mentioned
- RA_UNDERGROUND_SERVICES: Yes for almost all projects with any groundworks
- RA_WORK_AT_HEIGHT: Yes if any work above ground level including roof, scaffold or ladders
- RA_COSHH: Yes for all projects involving chemicals, dust, solvents or hazardous materials
- RA_WORKING_NEAR_WATER: Yes only if site is near water
- RA_GENERAL_BUILDING: Yes for all projects
- RA_PILING: Yes only if piling explicitly mentioned
- RA_REFURB_OCCUPIED: Yes only if works are in an occupied building
- RA_ASBESTOS: Yes if building constructed before 2000 or asbestos survey mentioned

RESPONSE FORMAT:
Return ONLY a valid JSON object with no preamble, no markdown, no explanation.
Every variable key must be present. Use null for not found.
`

async function fetchDocumentText(url) {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || ''
    const buffer = await response.arrayBuffer()
    const nodeBuffer = Buffer.from(buffer)
    if (contentType.includes('pdf') || url.toLowerCase().includes('.pdf')) {
      const pdfParse = (await import('pdf-parse')).default
      const data = await pdfParse(nodeBuffer)
      return data.text || null
    }
    if (contentType.includes('wordprocessingml') || url.toLowerCase().includes('.docx')) {
      const mammoth = (await import('mammoth')).default
      const result = await mammoth.extractRawText({ buffer: nodeBuffer })
      return result.value || null
    }
    if (url.toLowerCase().includes('.xlsx') || url.toLowerCase().includes('.xls')) {
      return `[Excel file: ${url.split('/').pop()} - schedule of works or similar]`
    }
    if (contentType.includes('text')) {
      return nodeBuffer.toString('utf-8')
    }
    return null
  } catch (err) {
    console.warn('[cdm-extract] document fetch failed:', url, err.message)
    return null
  }
}

async function extractWithClaude(documentsText) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not set')
  const variableList = CDM_VARIABLES.join('\n')
  const userMessage = `Please extract the following variables from the construction project documents provided below.\n\nVARIABLES TO EXTRACT:\n${variableList}\n\nPROJECT DOCUMENTS:\n${documentsText}\n\nReturn ONLY the JSON object with all variables. No other text.`
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      system: CDM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Anthropic error ${response.status}`)
  }
  const data = await response.json()
  const rawText = data.content?.[0]?.text || ''
  try {
    const clean = rawText.replace(/```json/g, '').replace(/```/g, '').trim()
    return JSON.parse(clean)
  } catch (parseErr) {
    console.error('[cdm-extract] JSON parse failed:', rawText.slice(0, 500))
    throw new Error('Claude returned invalid JSON')
  }
}

function identifyMissingVariables(extracted) {
  const missing = []
  const found = []
  const raVariables = []
  CDM_VARIABLES.forEach(key => {
    if (key.startsWith('RA_')) {
      raVariables.push({ key, value: extracted[key] || 'Yes' })
    } else if (!extracted[key]) {
      missing.push(key)
    } else {
      found.push(key)
    }
  })
  return { missing, found, raVariables }
}

function buildCompletionChecklist(extracted) {
  const checklist = [
    { key: 'HOSPITAL_MAP_IMAGE', label: 'Hospital route map image', section: '1.2', required: true, autoFilled: false },
    { key: 'APPENDIX_A_SITE_LOGISTICS', label: 'Site logistics plan drawing', section: 'Appendix A', required: true, autoFilled: false },
    { key: 'APPENDIX_B_PHOTOS', label: 'Site photographs', section: 'Appendix B', required: false, autoFilled: false },
    { key: 'APPENDIX_C_PROGRAMME', label: 'Programme of works / Gantt chart', section: 'Appendix C', required: true, autoFilled: false },
    { key: 'APPENDIX_F_TRAFFIC_PLAN', label: 'Traffic management plan', section: 'Appendix F', required: true, autoFilled: false },
    { key: 'STATEMENT_SIGNATURES', label: 'Signed statement of commitment page', section: 'Statement page', required: true, autoFilled: false },
  ]
  if (extracted['RA_ASBESTOS'] === 'Yes') {
    checklist.push({ key: 'APPENDIX_H_ASBESTOS', label: 'Asbestos survey report', section: 'Appendix H', required: true, autoFilled: false })
  }
  if (extracted['RA_HOISTS'] === 'Yes') {
    checklist.push({ key: 'APPENDIX_G_LIFTING_PLAN', label: 'Construction lifting plan', section: 'Appendix G', required: true, autoFilled: false })
  }
  return checklist
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' })
  try {
    const { document_urls = [], project_id, company_profile = {} } = req.body || {}
    if (!document_urls.length) return res.status(400).json({ error: 'No document_urls provided' })
    console.log(`[cdm-extract] Processing ${document_urls.length} documents for project ${project_id}`)
    const documentTexts = await Promise.all(
      document_urls.map(async (url, index) => {
        const text = await fetchDocumentText(url)
        const filename = url.split('/').pop() || `Document ${index + 1}`
        if (!text) return `[Document ${index + 1}: ${filename} - could not be read]`
        return `\n--- DOCUMENT ${index + 1}: ${filename} ---\n${text.slice(0, 8000)}\n--- END DOCUMENT ${index + 1} ---\n`
      })
    )
    const combinedText = documentTexts.join('\n\n')
    console.log(`[cdm-extract] Total text extracted: ${combinedText.length} characters`)
    const extracted = await extractWithClaude(combinedText)
    const merged = { ...extracted }
    if (company_profile.company_name) merged['PRINCIPAL_CONTRACTOR_COMPANY'] = company_profile.company_name
    if (company_profile.company_address) merged['PRINCIPAL_CONTRACTOR_ADDRESS'] = company_profile.company_address
    if (company_profile.company_phone) merged['PRINCIPAL_CONTRACTOR_PHONE'] = company_profile.company_phone
    if (company_profile.company_email) merged['PRINCIPAL_CONTRACTOR_EMAIL'] = company_profile.company_email
    if (company_profile.contracts_director_name) merged['CONTRACTS_DIRECTOR_NAME'] = company_profile.contracts_director_name
    if (company_profile.contracts_director_phone) merged['CONTRACTS_DIRECTOR_PHONE'] = company_profile.contracts_director_phone
    if (company_profile.contracts_director_email) merged['CONTRACTS_DIRECTOR_EMAIL'] = company_profile.contracts_director_email
    if (company_profile.project_manager_name) merged['PROJECT_MANAGER_NAME'] = company_profile.project_manager_name
    if (company_profile.project_manager_phone) merged['PROJECT_MANAGER_PHONE'] = company_profile.project_manager_phone
    if (company_profile.project_manager_email) merged['PROJECT_MANAGER_EMAIL'] = company_profile.project_manager_email
    if (company_profile.site_manager_name) merged['SITE_MANAGER_NAME'] = company_profile.site_manager_name
    if (company_profile.hs_adviser_name) merged['HS_ADVISER_NAME'] = company_profile.hs_adviser_name
    const { missing, found, raVariables } = identifyMissingVariables(merged)
    const completionChecklist = buildCompletionChecklist(merged)
    console.log(`[cdm-extract] Found: ${found.length} variables, Missing: ${missing.length} variables`)
    return res.status(200).json({
      success: true,
      extracted: merged,
      missing,
      found,
      ra_variables: raVariables,
      completion_checklist: completionChecklist,
      document_count: document_urls.length,
      text_length: combinedText.length,
    })
  } catch (err) {
    console.error('[cdm-extract] error:', err)
    return res.status(500).json({ error: err.message || 'CDM extraction failed', success: false })
  }
}
