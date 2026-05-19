function clean(value) {
  return value ? String(value).trim() : '';
}

function todayLong() {
  return new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function joinNames(name1, name2) {
  const n1 = clean(name1);
  const n2 = clean(name2);
  if (n1 && n2) return `${n1} & ${n2}`;
  return n1 || n2 || '';
}

export function buildBOLOAPlaceholders(project = {}) {
  const bo1 = clean(project.bo_1_name || project.bo || project.building_owner_name);
  const bo2 = clean(project.bo_2_name);
  const hasBO2 = !!bo2;

  const boPremise = clean(project.bo_premise_address || project.address);
  const boServiceAddress = clean(
    project.bo_service_address ||
    project.bo_1_service_address ||
    project.bo_address ||
    boPremise
  );

  return {
    BO_I_WE: hasBO2 ? 'We' : 'I',
    BO_AM_ARE: hasBO2 ? 'are' : 'am',
    BO_MY_OUR: hasBO2 ? 'our' : 'my',
    BO_OWNER_S: hasBO2 ? 'Building Owners' : 'Building Owner',

    BO_NAME_1: bo1,
    BO_NAME_2: bo2,
    'BO_&': hasBO2 ? '&' : '',

    BO_PREMISE: boPremise,
    BO_SERVICE_ADDRESS: boServiceAddress,

    'DATE HERE': todayLong(),
    BO_2_DATE_HERE: hasBO2 ? todayLong() : '',

    'SIGN HERE': '',
    BO_2_SIGN_HERE: hasBO2 ? '' : ''
  };
}

export function buildAOLOAPlaceholders(project = {}, ao = {}) {
  const ao1 = clean(ao.name || ao.ao_name || ao.owner_name);
  const ao2 = clean(ao.name2 || ao.ao_name_2 || ao.owner_name_2);
  const hasAO2 = !!ao2;

  const aoPremise = clean(
    ao.premise ||
    ao.reg_addr ||
    ao.address ||
    project.ao_premise_address
  );

  const aoServiceAddress = clean(
    ao.service_address ||
    ao.serviceAddress ||
    ao.reg_addr ||
    aoPremise
  );

  const boPremise = clean(project.bo_premise_address || project.address);

  return {
    AO_WE_I: hasAO2 ? 'We' : 'I',
    AO_AM_ARE: hasAO2 ? 'are' : 'am',
    AO_MY_OUR: hasAO2 ? 'our' : 'my',
    AO_OWNER_S: hasAO2 ? 'Adjoining Owners' : 'Adjoining Owner',

    AO_NAME_1: ao1,
    AO_NAME_2: ao2,
    'AO_&': hasAO2 ? '&' : '',

    AO_PREMISE: aoPremise,
    AO_SERVICE_ADDRESS: aoServiceAddress,
    BO_PREMISE: boPremise,

    'DATE HERE': todayLong(),
    AO_2_DATE_HERE: hasAO2 ? todayLong() : '',

    'SIGN HERE': '',
    AO_2_SIGN_HERE: hasAO2 ? '' : ''
  };
}

export function buildLOAFileName(type, project = {}, ao = {}) {
  const ref = clean(project.ref || 'Project');
  const address = clean(project.address || project.bo_premise_address || 'Address')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_');

  if (type === 'ao') {
    const aoName = clean(ao.name || 'AO')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '_');

    return `${ref}_${aoName}_AO_LOA.docx`;
  }

  return `${ref}_${address}_BO_LOA.docx`;
}
