function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function ordinalSuffix(day) {
  const n = Number(day);
  if ([11, 12, 13].includes(n % 100)) return 'th';
  if (n % 10 === 1) return 'st';
  if (n % 10 === 2) return 'nd';
  if (n % 10 === 3) return 'rd';
  return 'th';
}

function longDate(value) {
  if (!value) return '';
  try {
    const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return clean(value);
    const date = new Date(year, month - 1, day);
    const monthName = date.toLocaleString('en-GB', { month: 'long' });
    return `${day}${ordinalSuffix(day)} ${monthName} ${year}`;
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

function ownerWords(hasSecond) {
  return {
    OWNER_S_S: hasSecond ? 'Owners' : 'Owner',
    OWNER_S: hasSecond ? 'owners' : 'owner',
    OWNER_POSSESSIVE: hasSecond ? "Owners'" : "Owner's",
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


/**
 * Format section_2_subsections string into bracketed format.
 * "a, f, j, k" → "(a)(f)(j)(k)"
 */
function formatS2Subsections(raw) {
  if (!raw) return '';
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => `(${s})`)
    .join('');
}

/**
 * Build the sections string for a single notice run.
 * Order: Section 6(1) first, Section 1(5) second, Section 2(2)(subsections) last.
 * e.g. "Sections 6(1), 1(5) and 2(2)(a)(f)(j)(k)"
 */
function buildSectionsString(sections, s2Subsections = '') {
  const parts = [];
  if (sections.includes('s6')) parts.push('6(1)');
  if (sections.includes('s1')) parts.push('1(5)');
  if (sections.includes('s2')) {
    const sub = formatS2Subsections(s2Subsections);
    parts.push(`2(2)${sub}`);
  }
  if (!parts.length) return '';
  if (parts.length === 1) return `Section ${parts[0]}`;
  const last = parts.pop();
  return `Sections ${parts.join(', ')} and ${last}`;
}

/**
 * Build multi-run notice placeholders from an array of notice run records.
 * Each run: { run_number, notice_date, section_1, section_2, section_6, section_2_subsections }
 * Returns placeholders for up to 3 runs.
 */
export function buildNoticeRunPlaceholders(noticeRuns = []) {
  const sorted = [...noticeRuns].sort((a, b) => (a.run_number || 1) - (b.run_number || 1));
  const out = {};

  for (let i = 0; i < 3; i++) {
    const n = i + 1;
    const run = sorted[i];

    if (run) {
      const sections = [];
      if (run.section_6) sections.push('s6');
      if (run.section_1) sections.push('s1');
      if (run.section_2) sections.push('s2');

      const sectionsStr = buildSectionsString(sections, run.section_2_subsections || '');
      const dateStr = longDate(run.notice_date || '');

      out[`notice_run_${n}_sections`] = sectionsStr;
      out[`notice_run_${n}_date`] = dateStr;
      out[`notice_run_${n}_space`] = ' ';
      out[`NOTICE_RUN_${n}_SPACE`] = ' ';
      // Connector for the NEXT run — "and a further Notice under" or blank
      const hasNext = !!sorted[i + 1];
      out[`notice_run_${n}_and`] = hasNext ? 'and a further Notice under' : '';

      // Section 2 subsections for this run (formatted as (a)(f)(j)(k))
      const s2SubRaw = run.section_2_subsections || '';
      const s2SubFormatted = s2SubRaw
        ? s2SubRaw.split(',').map(s => `(${s.trim()})`).filter(s => s.length > 2).join('')
        : '';
      out[`section_2_subsections_run_${n}`] = s2SubFormatted;
      out[`SECTION_2_SUBSECTIONS_RUN_${n}`] = s2SubFormatted;

      // Also uppercase aliases
      out[`NOTICE_RUN_${n}_SECTIONS`] = sectionsStr;
      out[`NOTICE_RUN_${n}_DATE`] = dateStr;
      out[`NOTICE_RUN_${n}_AND`] = hasNext ? 'and a further Notice under' : '';
    } else {
      // Run doesn't exist — blank all placeholders so they disappear in template
      out[`notice_run_${n}_sections`] = '';
      out[`notice_run_${n}_date`] = '';
      out[`notice_run_${n}_space`] = '';
      out[`NOTICE_RUN_${n}_SPACE`] = '';
      out[`notice_run_${n}_and`] = '';
      out[`section_2_subsections_run_${n}`] = '';
      out[`SECTION_2_SUBSECTIONS_RUN_${n}`] = '';
      out[`NOTICE_RUN_${n}_SECTIONS`] = '';
      out[`NOTICE_RUN_${n}_DATE`] = '';
      out[`NOTICE_RUN_${n}_AND`] = '';
    }

    // Comma placeholders — only for runs 1 and 2
    if (n < 3) {
      const hasNext = !!sorted[i + 1];
      out[`notice_run_${n}_,`] = hasNext ? ', ' : '';
      out[`NOTICE_RUN_${n}_,`] = hasNext ? ', ' : '';
    }

    // & placeholder — "and" if THIS run exists (for runs 2 and 3 only)
    if (n > 1) {
      out[`notice_run_${n}_&`] = run ? 'and' : '';
      out[`NOTICE_RUN_${n}_&`] = run ? 'and' : '';
    }
  }

  // "respectively" if more than one run exists
  const multipleRuns = sorted.filter(Boolean).length > 1;
  out['MULTIPLE_NOTICE_RUN_RESPECTFULLY'] = multipleRuns ? 'respectively' : '';
  out['multiple_notice_run_respectfully'] = multipleRuns ? 'respectively' : '';

  return out;
}

/**
 * Build SOC schedule placeholders from an array of soc_reports records.
 * Each: { schedule_number, inspection_date }
 * Returns placeholders for up to 3 schedules.
 */
export function buildSOCSchedulePlaceholders(socReports = []) {
  const sorted = [...socReports].sort((a, b) => (a.schedule_number || 1) - (b.schedule_number || 1));
  const out = {};

  for (let i = 0; i < 3; i++) {
    const n = i + 1;
    const soc = sorted[i];
    const dateStr = soc ? longDate(soc.inspection_date || '') : '';
    const hasNext = soc && !!sorted[i + 1];
    const andStr = hasNext ? 'and a further Schedule of Conditions dated' : '';

    out[`schedule_${n}_date`] = dateStr;
    out[`schedule_${n}_and`] = andStr;
    out[`SCHEDULE_${n}_DATE`] = dateStr;
    out[`SCHEDULE_${n}_AND`] = andStr;

    // Legacy single placeholder — always set to first SOC for backwards compatibility
    if (n === 1) {
      out['SOC_AGREED_DATE'] = dateStr;
      out['soc_agreed_date'] = dateStr;
    }
  }

  return out;
}

export function buildNoticePlaceholders(project = {}, ao = {}, options = {}) {
  const noticeDate = clean(options.noticeDate || options.notice_date);
  const noticeType = clean(options.noticeType || options.notice_type);
  const notifiableWorks = clean(options.notifiableWorks || options.notifiable_works || project.works);
  const isSection10 = ['s10', 'section_10', 'section 10'].includes(noticeType.toLowerCase());

  // Build combined sections string from allSections (all sections in this run)
  // Order: Section 6(1) first, Section 1(5) second, Section 2(2)(subsections) last
  const allSections = options.allSections || [noticeType];
  const s2Subsections = clean(options.section2Subsections || options.section_2_subsections || '');
  const noticeSectionsFull = buildSectionsString(allSections, s2Subsections);
  // Fallback for single-section documents
  const sectionFallbacks = { s1: 'Section 1(5)', s2: 'Section 2(2)', s6: 'Section 6(1)', s10: 'Section 10', cover: '' };
  const noticeSection = noticeSectionsFull || sectionFallbacks[noticeType] || clean(options.noticeSection || options.notice_section || noticeType);

  const originalNoticeDate = clean(options.originalNoticeDate || options.original_notice_date || options.previousNoticeDate || options.previous_notice_date || ao.notice_served_date || ao.noticeServedDate || ao.notice_date || noticeDate);
  const section10NoticeDate = clean(options.section10NoticeDate || options.section_10_notice_date || options.s10NoticeDate || options.s10_notice_date || noticeDate);

  const bo1 = clean(project.bo_1_name || project.bo || project.building_owner_name || project.bo_name);
  const bo2 = clean(project.bo_2_name || project.bo2_name);
  const boNames = joinNames(bo1, bo2);
  const boPremise = clean(project.bo_premise_address || project.address || project.premise_address);
  const boServiceAddress = clean(project.bo_service_address || project.bo_1_service_address || project.bo_address || boPremise);
  const boLogic = partyLogic(bo1, bo2, 'Building Owner', 'Building Owners');
  const boOwner = ownerWords(boLogic.hasSecond);

  const ao1 = clean(ao.name || ao.ao_name || ao.owner_name || ao.ao_1_name);
  const ao2 = clean(ao.name2 || ao.ao_name_2 || ao.owner_name_2 || ao.ao_2_name);
  const aoNames = joinNames(ao1, ao2);
  const aoPremise = clean(ao.premise || ao.reg_addr || ao.address || ao.ao_premise_address);
  const aoServiceAddress = clean(ao.service_address || ao.serviceAddress || ao.reg_addr || aoPremise);
  const aoLogic = partyLogic(ao1, ao2, 'Adjoining Owner', 'Adjoining Owners');
  const aoOwner = ownerWords(aoLogic.hasSecond);

  const displayedNoticeDate = isSection10 ? originalNoticeDate : noticeDate;

  const base = {
    PROJECT_ID: clean(project.id),
    PROJECT_REF: clean(project.ref),
    NOTICE_DATE: longDate(displayedNoticeDate),
    NOTICE_DATE_LONG: longDate(displayedNoticeDate),
    NOTICE_DATE_SHORT: displayedNoticeDate,
    SECTION_10_NOTICE_DATE: longDate(section10NoticeDate),
    SECTION_10_NOTICE_DATE_LONG: longDate(section10NoticeDate),
    SECTION_10_NOTICE_DATE_SHORT: section10NoticeDate,
    NOTICE_TYPE: noticeType,
    NOTICE_SECTION: noticeSection,
    NOTICE_SECTION_FULL: noticeSection,
    NOTICE_SECTIONS: noticeSection,
    NOTICE_SUBSECTION: clean(options.noticeSubsection || options.notice_subsection),
    SECTION_2_SUBSECTIONS: s2Subsections
      ? s2Subsections.split(',').map(s => `(${s.trim()})`).join('')
      : '',
    NOTIFIABLE_WORKS: notifiableWorks,
    WORKS: notifiableWorks,
    NOT_SAFEGUARDING: options.safeguarding ? '' : 'not',

    // AO service address split into lines for cover letter
    ...(() => {
      const parts = aoServiceAddress.split(',').map(s => s.trim()).filter(Boolean);
      // Group into max 3 lines — last two parts (postcode + city) stay together on line 3
      let line1 = '', line2 = '', line3 = '';
      if (parts.length === 1) { line1 = parts[0]; }
      else if (parts.length === 2) { line1 = parts[0]; line2 = parts[1]; }
      else if (parts.length === 3) { line1 = parts[0]; line2 = parts[1]; line3 = parts[2]; }
      else if (parts.length >= 4) {
        line1 = parts[0];
        line2 = parts.slice(1, parts.length - 2).join(', ');
        line3 = parts.slice(parts.length - 2).join(', ');
      }
      return {
        AO_SERVICE_LINE_1: line1, ao_service_line_1: line1,
        AO_SERVICE_LINE_2: line2, ao_service_line_2: line2,
        AO_SERVICE_LINE_3: line3, ao_service_line_3: line3,
      };
    })(),
    works_items: (options.works_items || (notifiableWorks ? [{ item: notifiableWorks }] : [])),
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
    BO_OWNER_S_S: boOwner.OWNER_S_S,
    BO_OWNER_S: boOwner.OWNER_S,
    BO_OWNER_POSSESSIVE: boOwner.OWNER_POSSESSIVE,
    BO_OWNER_S_POSSESSIVE: boOwner.OWNER_POSSESSIVE,
    BO_PARTY: boLogic.party_s,
    BO_PARTY_POSSESSIVE: boLogic.party_s_possessive,
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
    AO_OWNER_S_S: aoOwner.OWNER_S_S,
    AO_OWNER_S: aoOwner.OWNER_S,
    AO_OWNER_POSSESSIVE: aoOwner.OWNER_POSSESSIVE,
    AO_OWNER_S_POSSESSIVE: aoOwner.OWNER_POSSESSIVE,
    AO_PARTY: aoLogic.party_s,
    AO_PARTY_POSSESSIVE: aoLogic.party_s_possessive,
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
    OWNER_S_S: aoOwner.OWNER_S_S,
    OWNER_S: aoOwner.OWNER_S,
    OWNER_POSSESSIVE: aoOwner.OWNER_POSSESSIVE,
    OWNER_S_POSSESSIVE: aoOwner.OWNER_POSSESSIVE,
    PREMISE: aoPremise,
    PREMISE_ADDRESS: aoPremise,
    SERVICE_ADDRESS: aoServiceAddress,
    SURVEYOR_NAME: clean(project.surveyor_name || project.user_name || 'Itzik Darel'),
    SURVEYOR_FIRM: clean(project.surveyor_firm || 'Square One Consulting'),
    THIRD_SURVEYOR: clean(ao.third_surveyor_name || ao.thirdSurveyorName || ''),
    FURD_SURVEYOR: clean(ao.third_surveyor_name || ao.thirdSurveyorName || ''),
    THIRD_SURVEYOR_FIRM: clean(ao.third_surveyor_firm || ao.thirdSurveyorFirm || ''),
    FURD_SURVEYOR_FIRM: clean(ao.third_surveyor_firm || ao.thirdSurveyorFirm || ''),
    THIRD_SURVEYOR_EMAIL: clean(ao.third_surveyor_email || ao.thirdSurveyorEmail || ''),
    FURD_SURVEYOR_EMAIL: clean(ao.third_surveyor_email || ao.thirdSurveyorEmail || ''),
  };
  return addAliasFields(base);
}
