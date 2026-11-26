// Main Chat "create a project from this email": the model proposes inside a
// fixed marker block, JavaScript only parses it. These tests pin that the parse
// is mechanical and safe, and that the instruction lives only on the Main Chat
// surface (Surface Contract owns it — no other component repeats it).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { splitNewProjectProposal, buildSurfaceContract, NEW_PROJECT_START, NEW_PROJECT_END } from '../v2-prompt-assembly.js';

const block = (json) => `${NEW_PROJECT_START}\n${json}\n${NEW_PROJECT_END}`;

describe('splitNewProjectProposal', () => {
  it('takes the proposal out of the reply and keeps the words around it', () => {
    const raw = `I found two owners.\n\n${block(JSON.stringify({
      role: 'BO',
      property_address: '18 Harcourt Road, London N22 7XW',
      service_address: '',
      owners: [{ name: 'John Alan Smith', email: 'j@x.com', phone: '' }, { name: 'Mary Jane Smith' }],
      works: '',
    }))}`;
    const { reply, proposal } = splitNewProjectProposal(raw);
    expect(reply).toBe('I found two owners.');
    expect(reply).not.toContain('NEW_PROJECT');
    expect(proposal.role).toBe('BO');
    expect(proposal.owners.map((o) => o.name)).toEqual(['John Alan Smith', 'Mary Jane Smith']);
    expect(proposal.owners[0].email).toBe('j@x.com');
  });

  it('keeps names exactly as given — no tidying', () => {
    const { proposal } = splitNewProjectProposal(block('{"role":"AO","property_address":"1 A St","owners":[{"name":"  Siobhán  O\'Neill-Ng "}]}'));
    expect(proposal.owners[0].name).toBe("Siobhán O'Neill-Ng");
  });

  it('caps owners at two, drops nameless owners, and rejects an unknown role to empty', () => {
    const { proposal } = splitNewProjectProposal(block(JSON.stringify({
      role: 'surveyor', property_address: 'x', owners: [{ name: 'A' }, { name: '' }, { name: 'B' }, { name: 'C' }],
    })));
    expect(proposal.role).toBe('');
    expect(proposal.owners.map((o) => o.name)).toEqual(['A', 'B']);
  });

  it('gives no proposal (and still strips the block) when the JSON is broken or empty of substance', () => {
    expect(splitNewProjectProposal(`ok\n${block('{not json')}`)).toEqual({ reply: 'ok', proposal: null });
    expect(splitNewProjectProposal(`ok\n${block('{"role":"BO","owners":[]}')}`).proposal).toBeNull();
    expect(splitNewProjectProposal(`ok ${NEW_PROJECT_START} half open`).proposal).toBeNull();
  });

  it('leaves ordinary replies untouched', () => {
    expect(splitNewProjectProposal('Just a normal answer.')).toEqual({ reply: 'Just a normal answer.', proposal: null });
    expect(splitNewProjectProposal('')).toEqual({ reply: '', proposal: null });
  });
});

describe('surface contract ownership', () => {
  it('only Main Chat discuss/execute mode carries the new-project instruction', () => {
    expect(buildSurfaceContract('main_chat', 'discuss')).toContain(NEW_PROJECT_START);
    expect(buildSurfaceContract('main_chat', 'execute')).toContain(NEW_PROJECT_START);
    expect(buildSurfaceContract('main_chat', 'draft')).not.toContain(NEW_PROJECT_START);
    expect(buildSurfaceContract('project_chat', 'discuss')).not.toContain(NEW_PROJECT_START);
    expect(buildSurfaceContract('clause_request', 'draft')).not.toContain(NEW_PROJECT_START);
  });

  it('tells the model never to invent and that the app, not Nora, creates the project', () => {
    const c = buildSurfaceContract('main_chat', 'discuss');
    expect(c).toMatch(/never invent/i);
    expect(c).toMatch(/Confirm|confirmation card/);
    expect(c).toMatch(/EXACTLY/);
  });

  it('adds no second model call: the proposal is parsed from the one Terra reply', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(__dirname, '../../ely-smart.js'), 'utf8');
    const pipeline = source.slice(source.indexOf('async function runV2Pipeline('));
    const terraCalls = (pipeline.slice(0, pipeline.indexOf('\n}\n')).match(/model: mainModelConfig\.model/g) || []).length;
    expect(terraCalls).toBe(1);
    expect(source).toContain('splitNewProjectProposal(replyText)');
  });
});
