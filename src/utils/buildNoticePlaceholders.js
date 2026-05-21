function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function longDate(value) {
  if (!value) return '';
  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return clean(value);
  }
}

function joinNames(name1, name2) {
  const n1 = clean(name1);
  const n2 = clean(name2);
  if (n1 && n2) return `${n1} & ${n2}`;
  return n1 || n2 || '';
}

function partyLogic(name1, name2, singular, plural) {
  const hasSecond = !!clean(name2);
  return {
    hasSecond,
    party_s: hasSecond ? plural : singular,
    party_s_possessive: hasSecond ? `${plural}'` : `${singular}'s`,
    we_i: hasSecond ? 'We' : 'I',
    i_we: hasSecond ? 'We' : 'I',
    us_me: hasSecond ? 'us' : 'me',
    me_us: hasSecond ? 'us' : 'me',
    our_my: hasSecond ? 'our' : 'my',
    my_our: hasSecond ? 'our' : 'my',
    are_am: hasSecond ? 'are' : 'am',
    am_are: hasSecond ? 'are' : 'am',
    are_is: hasSecond ? 'are' : 'is',
    is_are: hasSecond ? 'are' : 'is',
    have_has: hasSecond ? 'have' : 'has',
    has_have: hasSecond ? 'have' : 'has',
    and_symbol: hasSecond ? '&' : '',
  };
}

function addAliasFields(base) {
  const out = { ...base };

  Object.entries(base).forEach(([key, value]) => {
    out[key.toLowerCase()] = value;
    out[key.toUpperCase()] = value;
    out[`{{${key}}}`] = value;
    out[`{{${key.toUpperCase()}}}`] = value;
  });

  return out;
}

export function buildNoticePlaceholders(project = {}, ao = {}, options = {}) {
  const noticeDate = clean(options.noticeDate || options.notice_date);
  const noticeType = clean(options.noticeType || options.notice_type);
  const noticeSection = clean(options.noticeSection || options.notice_section || noticeType);
  const notifiableWorks = clean(options.notifiableWorks || options.notifiable_works || project.works);

  const bo1 = clean(project.bo_1_name || project.bo || project.building_owner_name || project.bo_name);
  const bo2 = clean(project.bo_2_name || project.bo2_name);
  const boNames = joinNames(bo1, bo2);
  const boPremise = clean(project.bo_premise_address || project.address || project.premise_address);
  const boServiceAddress = clean(project.bo_service_address || project.bo_1_service_address || project.bo_address || boPremise);
  const boLogic = partyLogic(bo1, bo2, 'Building Owner', 'Building Owners');

  const ao1 = clean(ao.name || ao.ao_name || ao.owner_name || ao.ao_1_name);
  const ao2 = clean(ao.name2 || ao.ao_name_2 || ao.owner_name_2 || ao.ao_2_name);
  const aoNames = joinNames(ao1, ao2);
  const aoPremise = clean(ao.premise || ao.reg_addr || ao.address || ao.ao_premise_address);
  const aoServiceAddress = clean(ao.service_address || ao.serviceAddress || ao.reg_addr || aoPremise);

  // The notice templates already contain the word "Adjoining" before AO_OWNER_S,
  // so AO_OWNER_S must be "Owner" / "Owners", not "Adjoining Owner(s)".
  const aoLogic = partyLogic(ao1, ao2, 'Owner', 'Owners');

  const base = {
    PROJECT_ID: clean(project.id),
    PROJECT_REF: clean(project.ref),

    NOTICE_DATE: longDate(noticeDate),
    NOTICE_DATE_SHORT: noticeDate,
    NOTICE_TYPE: noticeType,
    NOTICE_SECTION: noticeSection,
    NOTICE_SECTION_FULL: noticeSection,
    NOTICE_SUBSECTION: clean(options.noticeSubsection || options.notice_subsection),
    NOTIFIABLE_WORKS: notifiableWorks,
    WORKS: notifiableWorks,

    BO_NAME: boNames,
    BO_NAMES: boNames,
    BO_NAME_1: bo1,
    BO_NAME_2: bo2,
    BO_1_NAME: bo1,
    BO_2_NAME: bo2,
    BO_PREMISE: boPremise,
    BO_PREMISE_ADDRESS: boPremise,
    BO_ADDRESS: boPremise,
    BO_SERVICE_ADDRESS: boServiceAddress,
    BO_REG_ADDR: boServiceAddress,
    BO_OWNER_S: boLogic.party_s,
    BO_OWNER_S_POSSESSIVE: boLogic.party_s_possessive,
    BO_WE_I: boLogic.we_i,
    BO_I_WE: boLogic.i_we,
    BO_US_ME: boLogic.us_me,
    BO_ME_US: boLogic.me_us,
    BO_OUR_MY: boLogic.our_my,
    BO_MY_OUR: boLogic.my_our,
    BO_ARE_AM: boLogic.are_am,
    BO_AM_ARE: boLogic.am_are,
    BO_ARE_IS: boLogic.are_is,
    BO_IS_ARE: boLogic.is_are,
    BO_HAVE_HAS: boLogic.have_has,
    BO_HAS_HAVE: boLogic.has_have,
    'BO_&': boLogic.and_symbol,

    AO_NAME: aoNames,
    AO_NAMES: aoNames,
    AO_NAME_1: ao1,
    AO_NAME_2: ao2,
    AO_1_NAME: ao1,
    AO_2_NAME: ao2,
    AO_PREMISE: aoPremise,
    AO_PREMISE_ADDRESS: aoPremise,
    AO_ADDRESS: aoPremise,
    AO_SERVICE_ADDRESS: aoServiceAddress,
    AO_REG_ADDR: aoServiceAddress,
    AO_OWNER_S: aoLogic.party_s,
    AO_OWNER_S_POSSESSIVE: aoLogic.party_s_possessive,
    AO_WE_I: aoLogic.we_i,
    AO_I_WE: aoLogic.i_we,
    AO_US_ME: aoLogic.us_me,
    AO_ME_US: aoLogic.me_us,
    AO_OUR_MY: aoLogic.our_my,
    AO_MY_OUR: aoLogic.my_our,
    AO_ARE_AM: aoLogic.are_am,
    AO_AM_ARE: aoLogic.am_are,
    AO_ARE_IS: aoLogic.are_is,
    AO_IS_ARE: aoLogic.is_are,
    AO_HAVE_HAS: aoLogic.have_has,
    AO_HAS_HAVE: aoLogic.has_have,
    'AO_&': aoLogic.and_symbol,

    OWNER: aoNames,
    OWNER_S: aoLogic.party_s,
    OWNER_S_POSSESSIVE: aoLogic.party_s_possessive,
    PREMISE: aoPremise,
    PREMISE_ADDRESS: aoPremise,
    SERVICE_ADDRESS: aoServiceAddress,

    SURVEYOR_NAME: clean(project.surveyor_name || project.user_name || 'Itzik Darel'),
    SURVEYOR_FIRM: clean(project.surveyor_firm || 'Square One Consulting'),
  };

  return addAliasFields(base);
}
