/**
 * projectProposal.js — a new-project proposal from Main Chat.
 *
 * Nora reads the linked email and proposes the project's details; the app shows
 * them on a confirm card. These helpers turn the proposal into the same form
 * shape the New Project form uses (so utils/createProject.js builds an identical
 * project either way) and say what is still missing, so the user is told before
 * they confirm rather than after a failed save.
 */

const blankOwner = () => ({ name: '', email: '', phone: '' });

const owner = (o) => ({
  name: String(o?.name || '').trim(),
  email: String(o?.email || '').trim(),
  phone: String(o?.phone || '').trim(),
});

/** The New Project form shape for this proposal. Mirrors NewProjectModal's own initial state. */
export function proposalToForm(proposal = {}) {
  const role = proposal.role === 'AO' ? 'AO' : 'BO';
  const o1 = owner(proposal.owners?.[0]);
  const o2 = owner(proposal.owners?.[1]);
  const premise = String(proposal.property_address || '').trim();
  const service = String(proposal.service_address || '').trim();

  const form = {
    project_type: 'party_wall',
    role,
    boPremise: '', boService: '', bo1: blankOwner(), bo2: blankOwner(),
    aoPremise: '', aoService: '', ao1: blankOwner(), ao2: blankOwner(),
    works: String(proposal.works || '').trim(),
    fee: '',
  };

  if (role === 'AO') {
    form.aoPremise = premise;
    form.aoService = service;
    form.ao1 = o1;
    form.ao2 = o2;
  } else {
    form.boPremise = premise;
    form.boService = service;
    form.bo1 = o1;
    form.bo2 = o2;
  }
  // Same flag the form uses for "service address is the same as the property".
  return { form, sameAddr: !service };
}

/** Plain-English list of what the project still needs before it can be created. Empty = ready. */
export function proposalProblems(proposal = {}) {
  const problems = [];
  if (proposal.role !== 'BO' && proposal.role !== 'AO') {
    problems.push("Which side you're acting for (building owner's or adjoining owner's surveyor)");
  }
  if (!String(proposal.property_address || '').trim()) problems.push("The property address");
  if (!String(proposal.owners?.[0]?.name || '').trim()) problems.push("The owner's full name");
  return problems;
}

export function roleLabel(role) {
  if (role === 'AO') return "Adjoining owner's surveyor";
  if (role === 'BO') return "Building owner's surveyor";
  return '';
}
