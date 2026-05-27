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
    const [year, month, day] = String(value)
      .slice(0, 10)
      .split('-')
      .map(Number);

    const date = new Date(year, month - 1, day);

    return `${day}${ordinalSuffix(day)} ${date.toLocaleString('en-GB', {
      month: 'long',
    })} ${year}`;
  } catch {
    return clean(value);
  }
}

function detectAwardType(project = {}, ao = {}, options = {}) {
  if (
    options.agreedSurveyor ||
    ao.agreed_surveyor ||
    ao.agreedSurveyor ||
    project.agreed_surveyor
  ) {
    return 'agreed_surveyor';
  }

  if (
    ao.s104b ||
    ao.s10_4_b ||
    ao.section_10_4_b ||
    ao.s104b_served_date
  ) {
    return 's104b';
  }

  return 'two_surveyor';
}

function templateKeyForAwardType(type) {
  if (type === 'agreed_surveyor') {
    return 'award_agreed_surveyor';
  }

  if (type === 's104b') {
    return 'award_s104b';
  }

  return 'award_two_surveyor';
}

function getSOCDate(project = {}, ao = {}) {
  return first(
    ao.soc_agreed_date,
    ao.soc_date,
    project.soc_agreed_date,
    project.soc_date
  );
}

export function buildAwardPlaceholders(
  project = {},
  ao = {},
  options = {}
) {
  const awardType = detectAwardType(project, ao, options);

  const templateKey = templateKeyForAwardType(awardType);

  const noticeDate = first(
    ao.notice_served_date,
    ao.notice_date,
    project.notice_served_date,
    project.notice_date,
    todayIso()
  );

  const section10Date = first(
    ao.s10_served_date,
    ao.section_10_notice_date,
    project.s10_served_date
  );

  const works = first(
    project.all_notifiable_works,
    project.notifiable_works,
    ao.notifiable_works,
    ''
  );

  const base = buildNoticePlaceholders(project, ao, {
    noticeDate,
    notifiableWorks: works,
  });

  const placeholders = {
    ...base,

    AWARD_TYPE: awardType,

    AWARD_DATE: longDate(todayIso()),

    AO_SURVEYOR_NAME:
      awardType === 'agreed_surveyor'
        ? ''
        : first(
            ao.surv_name,
            ao.ao_surveyor_name,
            ao.surveyorName
          ),

    AO_SURVEYOR_FIRM:
      awardType === 'agreed_surveyor'
        ? ''
        : first(
            ao.surv_firm,
            ao.ao_surveyor_firm,
            ao.surveyorFirm
          ),

    THIRD_SURVEYOR:
      awardType === 'agreed_surveyor'
        ? ''
        : first(
            project.third_surveyor,
            project.thirdSurveyor,
            ao.third_surveyor
          ),

    SOC_AGREED_DATE: longDate(getSOCDate(project, ao)),

    SECTION_10_NOTICE_DATE: longDate(section10Date),

    SECTION_10_4_B_DATE: longDate(
      first(
        ao.s104b_served_date,
        ao.section_10_4_b_date
      )
    ),

    SECTION_11_AMOUNT: first(
      ao.section_11_amount,
      project.section_11_amount,
      ''
    ),

    SECURITY_AMOUNT: first(
      ao.security_amount,
      project.security_amount,
      ''
    ),

    ALL_NOTIFIABLE_WORKS: works,

    AWARD_DEALING_WITH: works,
  };

  const missing = [];

  if (!placeholders.BO_NAME) {
    missing.push('Building Owner name');
  }

  if (!placeholders.AO_NAME) {
    missing.push('Adjoining Owner name');
  }

  if (!placeholders.NOTICE_DATE) {
    missing.push('Notice date');
  }

  if (!placeholders.ALL_NOTIFIABLE_WORKS) {
    missing.push('Notifiable works');
  }

  if (awardType !== 'agreed_surveyor') {
    if (!placeholders.AO_SURVEYOR_NAME) {
      missing.push('AO surveyor name');
    }

    if (!placeholders.THIRD_SURVEYOR) {
      missing.push('Third surveyor');
    }
  }

  if (
    awardType === 's104b' &&
    !placeholders.SECTION_10_NOTICE_DATE
  ) {
    missing.push('Section 10 notice date');
  }

  return {
    awardType,
    templateKey,
    placeholders,
    mergeData: placeholders,
    missing,
    isValid: missing.length === 0,
    fileName: `${project.address || 'Party Wall'} Award.docx`,
  };
}

export default buildAwardPlaceholders;
