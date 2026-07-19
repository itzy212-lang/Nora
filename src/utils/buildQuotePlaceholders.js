// src/utils/buildQuotePlaceholders.js

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function fmt(value) {
  const n = parseFloat(value || 0);
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function itemClientCharge(item) {
  const cost = parseFloat(item.cost || 0);
  const markup = parseFloat(item.markup_value || 0);
  if (item.markup_type === 'percentage') return cost + (cost * markup / 100);
  if (item.markup_type === 'fixed') return cost + markup;
  return parseFloat(item.client_charge || 0);
}

// Builds merge data for the pm_quote template. Client-facing only — never includes
// cost or margin fields, matching the same principle used everywhere else in the app
// (portal payments/approvals): the client sees the total price, never the breakdown
// behind it.
export function buildQuotePlaceholders(project = {}, scopeItems = []) {
  const rows = (scopeItems || []).map(item => ({
    TITLE: clean(item.title),
    DESCRIPTION: clean(item.description),
    PRICE: fmt(itemClientCharge(item)),
  }));

  const total = (scopeItems || []).reduce((sum, item) => sum + itemClientCharge(item), 0);

  return {
    PROJECT_ADDRESS: clean(project.bo_premise_address || project.bo_address),
    CLIENT_NAME: clean(project.client_name || project.bo_1_name),
    QUOTE_DATE: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    QUOTE_REF: clean(project.ref || project.id),
    items: rows,
    TOTAL: fmt(total),
  };
}

export function buildQuoteFileName(project = {}) {
  const address = clean(project.bo_premise_address || project.bo_address || 'Project')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_');
  return `${address}_Quote.pdf`;
}
