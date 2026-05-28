import { buildNoticePlaceholders } from './buildNoticePlaceholders';

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function first(...values) {
  return values.find(v => clean(v)) || '';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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

function safeFilePart(value) {
  return clean(value)
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function aoAddress(ao = {}) {
  return first(ao.premise, ao.reg_addr, ao.address, ao.ao_premise_address);
}

function aoSurveyorName(ao = {}) {
  return first(ao.surv_name, ao.surveyorName, ao.ao_surveyor_name, ao.appointed_surveyor_name);
}

function aoSurveyorFirm(ao = {}) {
  return first(ao.surv_firm, ao.surveyorFirm, ao.ao_surveyor_firm, ao.appointed_surveyor_firm);
}

function noticeServedDate(ao = {}, project = {}) {
  return first(ao.notice_served_date, ao.noticeServedDate, ao.notice_date, project.notice_served_date, project.notice_date);
}

function section10NoticeDate(ao = {}, project = {}) {
  return first(ao.s10_served_date, ao.s10ServedDate, ao.section_10_notice_date, project.s10_served_date);
}

function section104bDate(ao = {}, project = {}) {
  return first(ao.s104b_served_date, ao.s104bServedDate, ao.s10_4_b_served_date, ao.section_10_4_b_date, project.s104b_served_date);
}

function hasAgreedSurveyor(project = {}, ao = {}, options = {}) {
  return Boolean(
    options.agreedSurveyor ||
    options.agreed_surveyor ||
    ao.agreed_surveyor ||
    ao.agreedSurveyor ||
    ao.is_agreed_surveyor ||
    project.agreed_surveyor ||
    project.bo_agreed_surveyor
  );
}

function hasSection104b(project = {}, ao = {}) {
  const status = clean(ao.status).toLowerCase();

  return Boolean(
    section104bDate(ao, project) ||
    ao.s104b ||
    ao.s10_4_b ||
    ao.section_10_4_b ||
    ao.appointed_under_s104b ||
    status.includes('104b') ||
    status.includes('10(4)(b)') ||
    status.includes('10_4_b') ||
    status === 's104b'
  );
}

function detectAwardType(project = {}, ao = {}, options = {}) {
  const supplied = clean(options.awardType || options.award_type).toLowerCase();

  if (['agreed', 'agreed_surveyor', 'award_agreed_surveyor'].includes(supplied)) return 'agreed_surveyor';
  if (['s104b', '10_4_b', 'section_10_4_b', 'award_s104b'].includes(supplied)) return 's104b';
  if (['two_surveyor', 'standard', 'award_two_surveyor'].includes(supplied)) return 'two_surveyor';

  if (hasAgreedSurveyor(project, ao, options)) return 'agreed_surveyor';
  if (hasSection104b(project, ao)) return 's104b';

  return 'two_surveyor';
}

function templateKeyForAwardType(type) {
  if (type === 'agreed_surveyor') return 'award_as';
  if (type === 's104b') return 'award_s10';
  return 'award_2s';
}

function awardTypeLabel(type) {
  if (type === 'agreed_surveyor') return 'Agreed Surveyor Award';
  if (type === 's104b') return 'Section 10(4)(b) Award';
  return 'Draft Award';
}

function getSOCDate(project = {}, ao = {}, options = {}) {
  return first(
    options.socDate,
    options.soc_date,
    ao.soc_agreed_date,
    ao.soc_date,
    ao.schedule_of_condition_date,
    ao.scheduleOfConditionDate,
    project.soc_agreed_date,
    project.soc_date,
    project.schedule_of_condition_date,
    project.scheduleOfConditionDate
  );
}

function getWorks(project = {}, ao = {}, options = {}) {
  return first(
    options.awardDealingWith,
    options.award_dealing_with,
    options.allNotifiableWorks,
    options.all_notifiable_works,
    options.notifiableWorks,
    options.notifiable_works,
    project.award_dealing_with,
    project.all_notifiable_works,
    project.notifiable_works,
    project.works,
    ao.notifiable_works,
    ao.works
  );
}

function getThirdSurveyor(project = {}, ao = {}, options = {}) {
  return first(
    options.thirdSurveyor,
    options.third_surveyor,
    ao.third_surveyor,
    ao.thirdSurveyor,
    ao.third_surveyor_name,
    project.third_surveyor,
    project.thirdSurveyor,
    project.selected_third_surveyor,
    project.third_surveyor_name
  );
}

function getMoneyValue(...values) {
  const value = first(...values);
  if (!value) return '';
  return clean(value).replace(/^£+/, '');
}

function getNotice2(project = {}, ao = {}, options = {}) {
  const section = first(options.notice2Section, options.notice_2_section, ao.notice_2_section, project.notice_2_section);
  const date = first(options.notice2Date, options.notice_2_date, ao.notice_2_date, project.notice_2_date);
  const hasNotice2 = Boolean(section || date);

  return {
    NOTICE_2_SECTION: section,
    NOTICE_2_DATE: longDate(date),
    NOTICE_2_DATE_SHORT: date,
    NOTICE_2_DATE_LONG: longDate(date),
    NOTICE_2_AMPERSAND: hasNotice2 ? '&' : '',
    NOTICE_2_AND: hasNotice2 ? 'and' : '',
    'NOTICE_2_&': hasNotice2 ? '&' : '',
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

function validateAwardData({ awardType, placeholders }) {
  const missing = [];

  if (!placeholders.BO_NAME) missing.push('Building Owner name');
  if (!placeholders.BO_PREMISE) missing.push('Building Owner property address');
  if (!placeholders.BO_SERVICE_ADDRESS) missing.push('Building Owner service address');
  if (!placeholders.AO_NAME) missing.push('Adjoining Owner name');
  if (!placeholders.AO_PREMISE) missing.push('Adjoining Owner property address');
  if (!placeholders.AO_SERVICE_ADDRESS) missing.push('Adjoining Owner service address');
  if (!placeholders.NOTICE_DATE) missing.push('Notice date');
  if (!placeholders.NOTICE_SECTION_FULL) missing.push('Notice section');
  if (!placeholders.SOC_AGREED_DATE) missing.push('Schedule of Condition date');

  if (awardType !== 'agreed_surveyor') {
    if (!placeholders.AO_SURVEYOR_NAME) missing.push('Adjoining Owner surveyor name');
    if (!placeholders.AO_SURVEYOR_FIRM) missing.push('Adjoining Owner surveyor firm');
    if (!placeholders.THIRD_SURVEYOR) missing.push('Third surveyor');
  }

  if (awardType === 's104b') {
    if (!placeholders.SECTION_10_NOTICE_DATE) missing.push('Section 10 notice date');
    if (!placeholders.SECTION_10_4_B_DATE) missing.push('Section 10(4)(b) date');
  }

  return missing;
}

function buildAwardFileName(ao = {}, awardType = 'two_surveyor') {
  const address = safeFilePart(aoAddress(ao) || 'Adjoining Owner Address');
  return `${awardTypeLabel(awardType)} - ${address}.docx`;
}

export function buildAwardPlaceholders(project = {}, ao = {}, options = {}) {
  const awardType = detectAwardType(project, ao, options);
  const templateKey = templateKeyForAwardType(awardType);

  const noticeDate = noticeServedDate(ao, project) || first(options.noticeDate, options.notice_date) || todayIso();
  const section10Date = section10NoticeDate(ao, project);
  const section104bServedDate = section104bDate(ao, project);
  const socDate = getSOCDate(project, ao, options);
  const works = getWorks(project, ao, options);

  const noticeSection = first(
    options.noticeSection,
    options.notice_section,
    ao.notice_section,
    project.notice_section,
    project.notice_section_full,
    'Section 1, Section 3 and/or Section 6'
  );

  const base = buildNoticePlaceholders(project, ao, {
    noticeType: awardType === 's104b' ? 's10' : 'award',
    noticeSection,
    noticeDate,
    originalNoticeDate: noticeDate,
    section10NoticeDate: section10Date || '',
    notifiableWorks: works,
  });

  const extra = {
    AWARD_TYPE: awardType,
    AWARD_TYPE_LABEL: awardTypeLabel(awardType),
    AWARD_TEMPLATE_KEY: templateKey,

    AWARD_DATE: longDate(first(options.awardDate, options.award_date, todayIso())),
    AWARD_DATE_SHORT: first(options.awardDate, options.award_date, todayIso()),

    AO_SURVEYOR_NAME: awardType === 'agreed_surveyor' ? '' : aoSurveyorName(ao),
    AO_SURVEYOR_FIRM: awardType === 'agreed_surveyor' ? '' : aoSurveyorFirm(ao),

    THIRD_SURVEYOR: awardType === 'agreed_surveyor' ? '' : getThirdSurveyor(project, ao, options),

    SOC_AGREED_DATE: longDate(socDate),
    SOC_AGREED_DATE_SHORT: socDate,

    SECTION_10_NOTICE_DATE: longDate(section10Date),
    SECTION_10_NOTICE_DATE_SHORT: section10Date,

    SECTION_10_4_B_DATE: longDate(section104bServedDate),
    SECTION_10_4_B_DATE_SHORT: section104bServedDate,
    S104B_DATE: longDate(section104bServedDate),
    S104B_DATE_SHORT: section104bServedDate,

    SECTION_11_AMOUNT: getMoneyValue(options.section11Amount, options.section_11_amount, ao.section_11_amount, project.section_11_amount),
    SECURITY_AMOUNT: getMoneyValue(options.securityAmount, options.security_amount, ao.security_amount, project.security_amount),

    ALL_NOTIFIABLE_WORKS: works,
    AWARD_DEALING_WITH: works,
    NOTIFIABLE_WORKS: works,
    WORKS: works,

    ...getNotice2(project, ao, options),
  };

  const placeholders = addAliasFields({
    ...base,
    ...extra,
  });

  const missing = validateAwardData({ awardType, placeholders });

  return {
    templateKey,
    awardType,
    awardTypeLabel: awardTypeLabel(awardType),
    fileName: buildAwardFileName(ao, awardType),
    mergeData: placeholders,
    placeholders,
    missing,
    isValid: missing.length === 0,
  };
}

export default buildAwardPlaceholders;