// api/review-award.js — extracts DOCX text then reviews with OpenAI GPT-4o

// Master award template — extracted from Itzik Darel's Draft_Award.docx
const MASTER_AWARD_TEXT = `PARTY WALL AWARD

“The Parties”

Building {{BO_OWNER_S_S}}: {{BO_NAME_1}} {{BO_&}} {{BO_NAME_2}}

Address for Service: {{BO_SERVICE_ADDRESS}}

Adjoining {{AO_OWNER_S_S}}: {{AO_NAME_1}} {{AO_&}} {{AO_NAME_2}}

Address for Service: {{AO_SERVICE_ADDRESS}}

“The Relevant Properties”

Building {{BO_OWNER_POSSESSIVE}} Property: {{BO_PREMISE}}

Adjoining {{AO_OWNER_POSSESSIVE}} Property: {{AO_PREMISE}}

“The Notices”

Notices under section {{NOTICE_SECTION_FULL}} Dated {{NOTICE_DATE}}

“The Principal Award”

This Award Dated \${AWARD_DATE}

“The Two Surveyors”

Building {{BO_OWNER_POSSESSIVE}} Surveyor: Itzik Darel MIPWS ACIArb of
Square One Consulting, Suite 28, 708A High Road, London, N12 9QL

Adjoining {{AO_OWNER_POSSESSIVE}} Surveyor: {{AO_SURVEYOR_NAME}} of
{{AO_SURVEYOR_FIRM}}

“Third Surveyor”

{{THIRD_SURVEYOR}}

  AN AWARD under the Party Wall etc. Act 1996, to be served on the
  Appointing Owners, under Section 10(14)

WHEREAS {{BO_NAME_1}} {{BO_&}} {{BO_NAME_2}} (hereinafter referred to as
the ‘Building {{BO_OWNER_S_S}}’) of {{BO_SERVICE_ADDRESS}} {{BO_IS_ARE}}
the {{BO_OWNER_S}} within the meaning of the Party Wall etc Act 1996
(the Act) of the premises known as {{BO_PREMISE}} (hereinafter referred
to collectively as the ‘Building {{BO_OWNER_POSSESSIVE}} property’).

AND WHEREAS {{AO_NAME_1}} {{AO_&}} {{AO_NAME_2}} (hereinafter referred
to the ‘Adjoining {{AO_OWNER_S_S}}’) of {{AO_SERVICE_ADDRESS}}
{{AO_IS_ARE}} the {{AO_OWNER_S}} within the meaning of the Act of the
premises known as {{AO_PREMISE}} (hereinafter referred to collectively
as the ‘Adjoining {{AO_OWNER_POSSESSIVE}}’ property’).

AND WHEREAS ON {{NOTICE_DATE}}, the Building {{BO_OWNER_S_S}} served
Notice on the Adjoining {{AO_OWNER_S_S}} under Sections
{{NOTICE_SECTION_FULL}} of the Act of their intention to execute the
building works described therein between the Building
{{BO_OWNER_POSSESSIVE}} property and the Adjoining
{{AO_OWNER_POSSESSIVE}} property (the two properties). That for the
purpose of this Award, notice served under Section 1(5) and 2(2)(g) can
be discounted as there is no party wall and the new flank wall of the
Building {{BO_OWNER_POSSESSIVE}} extension is to be offset from the
boundary.

AND WHEREAS a dispute has arisen, within the meaning of the Act.

AND WHEREAS the Building {{BO_OWNER_S_S}} {{BO_HAVE_HAS}} appointed
Itzik Darel MIPWS ACIArb of Square One Consulting, Suite 28, 708A High
Road, London, N12 9QL (hereinafter referred to as the 'Building
{{BO_OWNER_POSSESSIVE}}’ Surveyor) to act as their Surveyor and the
Adjoining {{AO_OWNER_S_S}} {{AO_HAVE_HAS}} appointed
{{AO_SURVEYOR_NAME}} of {{AO_SURVEYOR_FIRM}} (hereinafter referred to as
the 'Adjoining {{AO_OWNER_POSSESSIVE}} Surveyor’) to act as their
Surveyor.

AND WHEREAS the Building {{BO_OWNER_POSSESSIVE}} Surveyor and the
Adjoining {{AO_OWNER_POSSESSIVE}} Surveyor (hereinafter jointly referred
to as the ‘Two Surveyors’) have selected {{THIRD_SURVEYOR}} to act as
Third Surveyor in accordance with the provisions of the Act or, in the
event of him being unable or unwilling to act and they being unable to
jointly agree upon a substitute, a Surveyor to be selected by the
Appointing Officer of the relevant Local Authority in accordance with
Section 10(8) of the Act.

AND WHEREAS it is a requirement of the Act that the three Surveyors or
any two of them, or in the event of no two of them being in agreement,
the Third Surveyor, shall settle by Award all or any matter which is
connected with any work to which the Act relates and which is in dispute
between the Building {{BO_OWNER_S_S}} and the Adjoining {{AO_OWNER_S_S}}
including the right to execute the work; the time and manner of
executing the work and any other matter arising out of the dispute,
including the cost of obtaining and making this Award.

THAT this Award and its conditions relate only to the works described in
Clause 2 of this Award and do not relate to other works outside the
scope of the Act.

THAT any agreement or acceptance made by either surveyor in this award
or subsequently during works on site shall not be taken to imply any
responsibility by them or their appointed technical delegates for any
structural or any other insufficiency in any part of the works whether
existing or executed.

THAT the drawings and/or other documents provided by others and attached
to or referred to in this Award are accepted in good faith, taken to be
accurate (although the drawings may be reduced for inclusion herein) and
properly showing the details of the works to be undertaken.

THAT nothing in this award shall be held as conferring, admitting or
affecting any easement of light or other easement in or relating to the
party wall.

WHERE there is a conflict between the terms of this Award and the terms
of the Act, the terms of the Act take precedence.

THAT the Building {{BO_OWNER_S_S}} and/or the Adjoining
{{AO_OWNER_S_S}}, being the parties to the dispute, may within fourteen
days of the date this Award is served upon them, by virtue of Section
10(17) of the Act, appeal to the County Court against this Award.

THAT the said premises having been inspected and having considered the
proposals made by the building owner and any other relevant matters
brought to our attention but without prejudice to any other rights of
the parties or of any other persons DO HEREBY MAKE THIS OUR AWARD.

1.  NOW WE, being the Two Surveyors so appointed by the owners DO HEREBY
    AWARD AND DETERMINE as follows:-

(a) That the Building {{BO_OWNER_POSSESSIVE}} property and the Adjoining
      {{AO_OWNER_POSSESSIVE}} property is connected by a Party Wall and
      is standing within three metres of the Building
      {{BO_OWNER_POSSESSIVE}} property, within the meaning of the Act.

(b) That the Adjoining {{AO_OWNER_POSSESSIVE}} building as described in
      the attached Schedule of Condition are sufficient for the present
      purposes of the Adjoining {{AO_OWNER_S_S}}.

(c) A Schedule of Condition dated {{SOC_AGREED_DATE}} is attached hereto
      and relates to the adjacent parts of the Adjoining
      {{AO_OWNER_POSSESSIVE}} premises prior to the execution of the
      said work so far as can be ascertained without opening up or
      disturbing the structure or finishings. Copies of all photos will
      remain on file with the Two Surveyors and will not form part of
      this Award.

(d) That the drawings and other supporting documentation detailed
      further in the Documents Register and attached hereto form part of
      this Award.

2.  THAT following the service of this Award, and notwithstanding the
    Owners right to appeal in accordance with Section 10(17) of the Act,
    the Building {{BO_OWNER_S_S}} shall be at liberty, but without
    obligation, to carry out the following works (hereafter referred to
    as “the Works”):-

-   ALL_NOTIFIABLE_WORKS

3.  THAT in accordance with the provisions of Section 7(5) of the Act no
    deviation from the Works (as described in clause 2 above) shall be
    made without prior consultation with, and agreement by, the
    Adjoining {{AO_OWNER_S_S}}, or in the event of a dispute, determined
    by the Two Surveyors (or an award made by the Third Surveyor) in
    accordance with Section 10 of the Act. The Two Surveyors reserve the
    right to refer such changes to further Awards.

4.  THAT if the Building {{BO_OWNER_S_S}} exercises the above rights and
    carries out the Works described at Clause 2 of this Award they
    shall:

(a) Execute the whole of the aforesaid Works at the sole cost and risk
      of the Building {{BO_OWNER_S_S}}.

(b) Carry out the Works entirely in accordance with the drawings and
      documents attached to this Award and as listed on the Document
      Issue Register. Where there is inconsistency between the drawings
      to wordings of the Award, the Award shall stand

(c) Take all reasonable precautions and provide all necessary protection
      and support to retain the land and buildings comprised within the
      Adjoining {{AO_OWNER_POSSESSIVE}} property. Excavations must not
      remain open longer than 48 hours, nor over any weekend, and shall
      be covered with an impervious board in the event of heavy rain
      and, in any event, every night when the excavations remain open.
      Where necessary provide temporary supports in the form of
      reinforced shuttering ply to the sides of the excavations to
      protect them from collapse. If excavations are required to be
      deeper than the stipulated depth, works will stop and the
      Surveyors shall be invited to inspect and may require design input
      from the Structural Engineer.

(d) Back-shutter the foundation trench at the line of junction to ensure
      there is no concrete overspill onto the Adjoining
      {{AO_OWNER_POSSESSIVE}} land.

(e) Only where required by Section 2 of the Act, make good any/all
      structural, decorative or horticultural damage to the Adjoining
      {{AO_OWNER_POSSESSIVE}} property and/contents occasioned by the
      works in materials to match the existing fabric and finishes, to
      the reasonable satisfaction of the two Surveyors, with such making
      good to be executed upon completion of the works, or at any
      earlier time deemed appropriate by the two Surveyors. If so
      required by the Adjoining {{AO_OWNER_S_S}}, make payment in lieu
      of carrying out the work to make the damage good, with such sum to
      be agreed between the Owners or determined by the Two Surveyors.

(f) Compensate the Adjoining {{AO_OWNER_S_S}} or occupier for any loss
      of or damages which may result to any of them by reason of any
      works executed in pursuance of the Act, in accordance with Section
      7(2) of the Act.

(g) Ensure that the services and security systems of the Adjoining
      {{AO_OWNER_POSSESSIVE}} property are not affected as a result of
      the works.

(h) Maintain the security throughout the works of the Adjoining
      {{AO_OWNER_POSSESSIVE}} property where this is likely to be
      impaired by the works authorised by this Award. Secure any ladders
      or access equipment when the site is unattended and at the end of
      each working day. Take all required security precautions to ensure
      that any scaffolding/hoarding/fencing associated with the works
      does not prejudice the security of the Adjoining {{AO_OWNER_S_S}}
      by facilitating access to intruders. Ensure that the site is
      secure with no gaps allowing access to intruders.

(i) Carry out the whole of the Works, so far as practicable, from the
      Building {{BO_OWNER_POSSESSIVE}} side. Where access to the
      Adjoining {{AO_OWNER_POSSESSIVE}} property is required to carry
      out the Works from the Adjoining {{AO_OWNER_POSSESSIVE}} property
      14 days written notice shall be given in accordance with Section 8
      of the Act and that details and method statements thereof shall
      first be submitted to and approved by the two Surveyors, except in
      the case of any emergency, and such approval shall be subject to
      such conditions as the two Surveyors may stipulate.

(j) Be entitled for the Building {{BO_OWNER_POSSESSIVE}} contractor to
    have temporary access to an area of the Adjoining
    {{AO_OWNER_POSSESSIVE}} rear garden for the purposes of carrying out
    the Works under Clause 2.(**) & 2.(**) of this Award, **** subject
    to the Adjoining Owners and/or occupier(s) being given written
    Notice in accordance with the Act*** –*** being not less than
    fourteen days or otherwise as is reasonable in the event of an
    emergency (unless such notice period is waived by the Adjoining
    Owners)***. The duration of temporary access shall not exceed ***8
    weeks*** unless agreed otherwise to be extended by the Adjoining
    Owners, or in the event of dispute as determined by the appointed
    surveyors. Temporary access is also subject to:-

    i.  A suitable robust and imperforate temporary hoarding being
        erected separating the Adjoining {{AO_OWNER_S_S}}/occupiers from
        the working area (‘’the hoarded area’’). The hoarding shall be a
        maximum of 1000mm from the boundary. The hoarding shall be so
        formed so as not to obstruct the doors or windows of the
        Adjoining {{AO_OWNER_POSSESSIVE}} property.

    ii. Any parts of the Adjoining {{AO_OWNER_POSSESSIVE}}’ property
        within the hoarded area are to be suitably protected to include,
        but not limited to, plastic sheeting and rigid boarding to
        prevent damage and soiling during the Works. No access shall be
        permitted outside the hoarded area. The Works requiring hoarding
        shall be reasonably prioritised and the hoarding removed to
        minimise time required for access on the Adjoining
        {{AO_OWNER_POSSESSIVE}} land. Access to and temporary use of the
        Adjoining Owners’ property shall be via the Building
        {{BO_OWNER_POSSESSIVE}} rear garden only and must be limited to
        what is reasonably necessary to safely carry out the Works. Any
        Works carried out from the Adjoining {{AO_OWNER_POSSESSIVE}}
        property must be carried out in such a manner as to keep
        disturbance to the Adjoining {{AO_OWNER_S_S}} or occupiers to a
        minimum. No materials, equipment or the like shall be stored
        within the hoarded area.

    iii. ***The first half fence panel and post shall be removed,
         together with the first full panel beyond, in order to permit
         the return of the hoarding to terminate at or above the second
         fence post line.*** This arrangement will form a safe and
         secure access route for the Building {{BO_OWNER_POSSESSIVE}}
         contractors.

    iv. Upon completion of the erection of the ***flank*** wall, the
        hoarding shall be removed without delay and the Adjoining
        {{AO_OWNER_POSSESSIVE}} patio reinstated and made good.

(k) Ensure that boundary walls/fencing, adjacent to the notifiable
      works, shall be adequately protected/supported from disturbance by
      the notifiable works.

(l) Ensure that no air-bricks, vents, flues, terminals or any other
      openings are made in the new rear extension wall facing the
      Adjoining {{AO_OWNER_POSSESSIVE}} property. Ensure that no fascia,
      guttering or other projection is erected over the Adjoining
      {{AO_OWNER_POSSESSIVE}} property.

(m) No drainage of surface water from the building owner’s work should
      discharge onto the Adjoining {{AO_OWNER_POSSESSIVE}} property or
      extend over the line of junction.

(n) Fully indemnify the Adjoining {{AO_OWNER_S_S}} from liability in
      respect of any injury or loss of life to any person or damage to
      property caused by or in consequence of the execution of the said
      Works and bear the cost of making any justified claims.

(o) Maintain or cause contractor(s) to maintain adequate insurance
      against such risks and provide evidence of this upon demand by the
      Adjoining {{AO_OWNER_S_S}}.

(p) Permit the Two Surveyors, the Third Surveyor or their
      representatives to have access to the relevant parts of the
      Building {{BO_OWNER_POSSESSIVE}} property at all reasonable times
      during, and to inspect, the progress of the works.

(q) Ensure that dust and debris arising from the works which are the
      subject of this Award is cleared away from time to time as
      necessary and upon completion of the works or at the request of
      the Adjoining {{AO_OWNER_S_S}} and/or the two Appointed Surveyors.

(r) Take all necessary precautions to prevent nuisance from smoke, dust,
      rubbish, vermin and other causes of nuisance.

(s) Pay all statutory fees relating to the said Agreed Works in respect
      of their own and the Adjoining {{AO_OWNER_POSSESSIVE}} building
      and any other statutory costs arising out of or connected
      therewith.

(t) Ensure that the content of this Award is made known to any
      consultants, contractors or other persons engaged to facilitate or
      implement the Works.

(u) That the Building {{BO_OWNER_S}} will on commencement of
      construction pay to the Adjoining {{AO_OWNER_S_S}} a contribution
      of £\${SECTION_11_AMOUNT} under Section 11(11) of the Act for the
      use of that section of the party wall now to be enclosed against.

(v) Ensure any cutting into the party wall shall be undertaken using
      hand tools only, and shall be to a depth not exceeding half the
      thickness of the party wall as measured at the point of cutting
      in. Use only non-percussive hand-held tools or rotary disc cutters
      when cutting away from and/or into the party wall. Powered
      percussion tools (such as “Jack hammers” or “Kangos”) must not be
      used on the party wall without the prior agreement of the Two
      Surveyors

(w) Ensure that scaffold has the correct safety netting to safeguard
      from any falling debris.

(x) Where chimney breasts are removed, any voids formed within the party
      wall shall be fully infilled with brickwork or concrete blockwork
      laid in cement mortar. When cutting away masonry, percussion or
      hammer settings on handheld power tools shall not be used in order
      to minimise vibration. The party wall shall not be worked on using
      heavy power tools and no cutting or removal of masonry shall
      extend beyond one half of the wall’s thickness. Half brick headers
      must not be removed in isolation. Where removal is required, this
      shall only be undertaken by first removing the adjacent stretcher
      brick and then cutting the half brick header through its stretcher
      face. All works must be carried out carefully so as to avoid
      unnecessary disturbance to the remaining party wall masonry. The
      masonry of the party wall shall be properly made good in bonded
      brickwork and to the satisfaction of the Building Control Officer
      or Approved Inspector. Should any disturbance occur to the
      Adjoining {{AO_OWNER_POSSESSIVE}} half thickness of the party
      wall, this must be immediately reported to the Adjoining Owner
      and/or the Two Surveyors. All remaining masonry shall be
      adequately supported during the works and permanently reinstated
      in accordance with Building Control approved standards. Any open
      flues, fireplaces, or vents serving the Adjoining
      {{AO_OWNER_POSSESSIVE}} property shall be temporarily protected
      and suitably sealed to prevent debris, soot, or dust entering the
      Adjoining {{AO_OWNER_POSSESSIVE}} property. Reasonable requests
      for access required to implement these protections shall be made
      to the adjoining property. However, the works shall not be
      unreasonably delayed where such access cannot be obtained.

(y) Scaffolding to be cantilevered top lift over the adjoining owners
      air-space to give safe high-level access where and when necessary
      and provide protection from potential falling debris.

(z) Top scaffold to be double-boarded with polythene between, to include
      toe-boards on all open sides, guard rails on all open sides with
      anti-debris sheeting to enclose all scaffolding for privacy means

(a) No scaffolding is to stand on the Adjoining {{AO_OWNER_POSSESSIVE}}
      property or land.  Top lift scaffolding is not to obstruct any
      windows from opening and is to be above first floor window level
      head

(b) Ensure that any raised access scaffolding/platforms are properly,
      safely and securely assembled/erected by a CISRS certified
      scaffolding contractor, to include suitable guarding both to allow
      safe working from such scaffolding / access platforms and to
      prevent building materials or other objects or debris from falling
      on to or within the owners land and property. Any scaffold should
      be protected on all elevations and for the full height with
      Monoflex dust sheeting (or equal and approved) to ensure the
      owners have privacy from the adjoining owners’ contractor’s
      operations

(c) Upon exposure of the Adjoining {{AO_OWNER_POSSESSIVE}} property as a
      result of the works described within Clause 2, provide any
      temporary weatherproofing as necessary to exposed external walls
      to adjoining premises

(d) Immediately upon signs of distress, damage or movement to the
      Adjoining {{AO_OWNER_POSSESSIVE}} property, halt the works, inform
      the two Appointed Surveyors and instruct their Structural Engineer
      to provide a full structural assessment as to the problem, the
      causes and the solution recommending any additional remedial or
      protection works that may be necessary to enable the Building
      {{BO_OWNER_POSSESSIVE}} works to continue. This information is to
      be provided to the Two Surveyors in full and his agreement in
      writing obtained before the works can continue.

(e) Ensure that any new flashing is detailed and fixed in accordance
      with the recommendations of the Lead Sheet Training Academy Manuel
      (formerly known as the Lead Sheet Association).

(f) Not set down or store materials, tools, plant or waste at any time
      or on any part of the owners’ property or land that is not in the
      possession of the contractor in the normal pursuance of works
      executed as detailed in this award.

(g) Match any finished face brick with that of the surrounding area.

5.  THAT the Two Surveyors shall be permitted access to the relevant
    parts of the Adjoining {{AO_OWNER_POSSESSIVE}} property to inspect
    the progress of the works in accordance with Section 8.

6.  THAT the Building {{BO_OWNER_S_S}} shall, at all times, provide a
    secure protective screen between their work and the property of the
    Adjoining {{AO_OWNER_S_S}}, so as to mitigate noise,

7.  THAT the works shall be carried through with reasonable expedition
    after commencement and always in a manner so as to avoid unnecessary
    inconvenience to the Adjoining {{AO_OWNER_S_S}}.

8.  THAT the whole of the Works referred to in this Award shall be
    executed in accordance with the regulations and Bye-Laws of the
    Local Authority and other properly constituted authorities and to
    the satisfaction of the Building Control Officer or independent
    Certifying Officer and shall be executed in a proper and workmanlike
    manner in sound and suitable materials in accordance with the terms
    of this Award to the reasonable satisfaction of the Two Surveyors.
    The Works shall be carried out in accordance with the Code of
    Practice for noise and vibration control on construction and open
    sites [BS 5228].

9.  THAT noisy works which this Award relates to is restricted to
    between the hours of 08:00 and 17:00 on normal weekdays and 09.00
    and 13.00 on Saturdays. No other weekend or Bank or public holiday
    working allowed.

10. THAT a signed copy of the Award shall be served immediately on the
    Appointing Owners by their respective Surveyors. A copy of the Award
    shall be provided and retained on site for the Building
    {{BO_OWNER_POSSESSIVE}} contractor who shall be made aware of its
    contents.

11. THAT the Building {{BO_OWNER_S_S}} shall immediately on serving this
    Award pay the Adjoining {{AO_OWNER_POSSESSIVE}} Surveyor’s costs
    directly to the Surveyor in the sum of £TBC plus VAT in connection
    with the obtaining and making of this Award and one subsequent
    inspection of the works on completion. In the event of damage being
    caused or other contingencies or variations arising, a further fee
    shall be payable at the hourly rate of £TBC plus VAT.

12. THAT the two Surveyors agree that the Building {{BO_OWNER_S_S}}
    shall provide Security for Expenses to the Adjoining
    {{AO_OWNER_S_S}} under Section 12(1) of the Act in the sum of
    £\${SECURITY_AMOUNT}. This sum shall be paid by the Building
    {{BO_OWNER_S_S}} and placed in an escrow account to be held by the
    Building {{BO_OWNER_POSSESSIVE}} solicitor or escrow agent before
    any works commence. Such sum shall be held by the Building
    {{BO_OWNER_POSSESSIVE}} solicitor, or escrow agent, who shall
    acknowledge receipt of this sum to the two Surveyors upon receipt
    and furthermore acknowledge that the sum may not be released by
    either party to this Award, either in whole or in part, without
    receipt of written instructions from two of the three Surveyors. Any
    interest accrued on the sum shall be returned to the Building
    {{BO_OWNER_S_S}} upon serve of a final letter to the Building
    {{BO_OWNER_POSSESSIVE}} solicitor from two of the three Surveyors.

13. THAT the said Surveyors reserve the right to make and issue any
    further Awards that may be necessary, as provided in the Act

14. THAT we being the Two Surveyors, declare that, for the purpose of
    the Construction (Design & Management) Regulations 2015 (CDM2015)
    that we have not approved any design, such being referred back to
    the Designer and the Designer, in conjunction with the Principal
    Designer, who will, on behalf of the Building {{BO_OWNER_S_S}} vet
    for Health & Safety Competence and risk and resource allocation.

15. THAT this Award shall determine absolutely, and be null and void, if
    the authorised work does not commence within a period of 12 months
    of the deemed date of service of this Award, or if once commenced is
    ceased for a period in excess of 3 months.

16. THAT nothing in this Award shall be taken to imply any warranty by
    the Two Surveyors (or either of them or their respective servants or
    agents) as to the sufficiency, suitability or design of any of the
    building work to which this Award and the Act relates.

17. THAT the Building {{BO_OWNER_S_S}} shall notify the Surveyors as
    soon as they are satisfied that those works for which notice was
    served and for which this Award has been produced have been
    sufficiently completed to allow a final inspection to check the
    Schedule of Condition for possible damage.

18. THAT this Award does not determine the actual position of any
    boundary between the Adjoining {{AO_OWNER_POSSESSIVE}} property and
    the Building {{BO_OWNER_POSSESSIVE}} property and any reference to,
    or indication of, the boundary or boundary line on the drawings
    forming part of this Award is indicative only.

We have set our hands this \${AWARD_DATE}

_________________________________________________ Itzik Darel MIPWS
ACIArb

Building {{BO_OWNER_POSSESSIVE}} Surveyor

_________________________________________________ {{AO_SURVEYOR_NAME}}

Adjoining {{AO_OWNER_POSSESSIVE}} Surveyor

Party Wall Award Document Issue Register

In relation to works at: {{BO_PREMISE}}

Adjacent to: {{AO_PREMISE}}

That the following documents form part of this Award:

1.  Schedule of Condition of {{AO_PREMISE}} dated {{SOC_AGREED_DATE}}.
    Photos will not form part of this Award, but will remain on file
    with the Two Surveyors

2.  \${AWARD_DOC_REGISTER}

3.  \${AWARD_DOC_REGISTER}

Building {{BO_OWNER_POSSESSIVE}}
Surveyor.........................................................................................................

Adjoining {{AO_OWNER_POSSESSIVE}}
Surveyor.......................................................................................................
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  try {
    const { doc1_b64, doc2_b64, mode, system, chat_mode, chat_history } = req.body;

    // ── CHAT MODE — no document extraction needed ──────────────
    if (chat_mode && chat_history) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 2000,
          messages: [{ role: 'system', content: system }, ...chat_history],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'OpenAI error');
      return res.status(200).json({
        content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }],
      });
    }
    if (!doc1_b64) return res.status(400).json({ error: 'No document provided' });

    // Extract text from DOCX base64 using mammoth
    const mammoth = await import('mammoth');

    const extractText = async (b64) => {
      const buffer = Buffer.from(b64, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    };

    const text1 = await extractText(doc1_b64);
    const text2 = doc2_b64 ? await extractText(doc2_b64) : null;

    // Build the user prompt
    let userPrompt;
    if (mode === 'benchmark') {
      userPrompt = `Please review this party wall award against my master template award.

MY MASTER TEMPLATE AWARD (the benchmark):
${MASTER_AWARD_TEXT}

AWARD TO REVIEW:
${text1}

Your task:
1. MISSING CLAUSES — important clauses/provisions in my master that are absent from this award
2. WEAKER WORDING — clauses present but with weaker or less complete wording than my master
3. SPECIFIC IMPROVEMENTS — exact wording from my master that would strengthen this award
4. WHAT THIS AWARD HAS THAT MINE LACKS — any additions worth noting
5. CRITICAL ISSUES — anything legally problematic or missing before this can be served

Be specific. Quote exact clauses. Reference Act sections where relevant. Be direct — this is for a practising party wall surveyor.`;
    } else {
      userPrompt = `Please compare these two party wall award drafts.

DOCUMENT 1 — BASE DRAFT:
${text1}

DOCUMENT 2 — REVISED DRAFT:
${text2}

Tell me:
1. What has changed between Document 1 and Document 2 (additions, deletions, wording changes)
2. Which version is stronger for each changed clause and why
3. Any changes in Document 2 that weaken or introduce problems compared to Document 1
4. Any changes in Document 2 that improve on Document 1

Be specific — quote the exact wording differences. Reference the Act where relevant.`;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI API error');

    return res.status(200).json({
      content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }],
    });

  } catch (err) {
    console.error('[review-award] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
