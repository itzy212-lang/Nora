// api/generate-fee-quote.js
// Generates a party wall fee quote PDF from the template
// Accepts: client_name, property_address, works_description, num_aos,
//          fee_notice, fee_soc, fee_agreed, fee_separate, quote_ref

import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
         AlignmentType, BorderStyle, WidthType, ShadingType, LevelFormat } from 'docx';

const NAVY = "1E3A5F";
const LIGHT = "E8F0F8";
const GREY = "F5F5F5";
const MID = "444444";
const W = 9026;

const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const hdrBorder = { style: BorderStyle.SINGLE, size: 4, color: "FFFFFF" };
const hdrBorders = { top: hdrBorder, bottom: hdrBorder, left: hdrBorder, right: hdrBorder };

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 60, after: 80 },
    children: [new TextRun({ text, size: 20, font: "Arial", color: MID, ...opts })]
  });
}

function h1(text) {
  return new Paragraph({
    spacing: { before: 360, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 28, color: NAVY, font: "Arial" })]
  });
}

function h2(text) {
  return new Paragraph({
    spacing: { before: 200, after: 60 },
    children: [new TextRun({ text, bold: true, size: 21, color: NAVY, font: "Arial" })]
  });
}

function infoRow(label, value) {
  return new TableRow({
    children: [
      new TableCell({
        borders: noBorders,
        width: { size: 2800, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 0, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 19, font: "Arial", color: MID })] })]
      }),
      new TableCell({
        borders: noBorders,
        width: { size: 6226, type: WidthType.DXA },
        margins: { top: 60, bottom: 60 },
        children: [new Paragraph({ children: [new TextRun({ text: value, size: 19, font: "Arial", color: "#111827" })] })]
      })
    ]
  });
}

function feeRow(option, description, fee, shade = false) {
  return new TableRow({
    children: [
      new TableCell({ borders, shading: shade ? { fill: GREY, type: ShadingType.CLEAR } : undefined, width: { size: 800, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: option, bold: true, size: 19, font: "Arial", color: NAVY })] })] }),
      new TableCell({ borders, shading: shade ? { fill: GREY, type: ShadingType.CLEAR } : undefined, width: { size: 6426, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: description, size: 19, font: "Arial", color: "#111827" })] })] }),
      new TableCell({ borders, shading: shade ? { fill: GREY, type: ShadingType.CLEAR } : undefined, width: { size: 1800, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fee, bold: true, size: 20, font: "Arial", color: NAVY })] })] }),
    ]
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, size: 19, font: "Arial", color: MID })]
  });
}

function fmt(amount) {
  return `£${Number(amount).toLocaleString('en-GB')}`;
}

function today() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function validUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function generateQuoteRef() {
  const now = new Date();
  return `SQ1-FQ-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*900+100)}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const {
      client_name = '{{Client Name}}',
      property_address = '{{Property Address}}',
      works_description = '{{Description of Works}}',
      num_aos = '1',
      fee_notice = '100',
      fee_soc = '300',
      fee_agreed = '450',
      fee_separate = '600',
      quote_ref,
    } = body;

    const ref = quote_ref || generateQuoteRef();
    const numAOs = String(num_aos);
    // Stage 2D is an ADDITION on top of Stage 2C (fee_agreed), not a standalone
    // alternative fee — the surveyor's representation cost (fee_agreed) doesn't
    // disappear if the adjoining owner appoints their own surveyor; an extra
    // amount (fee_separate) is added for the additional negotiation work.
    const maxTotal = parseInt(fee_notice) + parseInt(fee_agreed) + parseInt(fee_separate);

    const doc = new Document({
      numbering: {
        config: [
          { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 180 } } } }] }
        ]
      },
      styles: { default: { document: { run: { font: "Arial", size: 20 } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 }
          }
        },
        children: [
          // HEADER
          new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: "SQUARE ONE CONSULTING", bold: true, size: 24, color: NAVY, font: "Arial" })] }),
          new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: "Party Wall Surveying | Construction Management | Dispute Resolution", size: 18, color: MID, font: "Arial" })] }),
          new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: "help@sq1consulting.co.uk  |  07889 996 841  |  www.sq1consulting.co.uk", size: 18, color: MID, font: "Arial" })] }),
          new Paragraph({ spacing: { before: 280, after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 1 } }, children: [] }),

          // TITLE
          new Paragraph({ spacing: { before: 400, after: 60 }, children: [new TextRun({ text: "FEE QUOTATION", bold: true, size: 48, color: NAVY, font: "Arial" })] }),
          new Paragraph({ spacing: { before: 0, after: 320 }, children: [new TextRun({ text: "Party Wall Surveying Services", size: 24, color: MID, font: "Arial" })] }),

          // PROJECT DETAILS
          new Table({
            width: { size: W, type: WidthType.DXA },
            columnWidths: [2800, 6226],
            rows: [
              infoRow("Quote Reference:", ref),
              infoRow("Date:", today()),
              infoRow("Valid Until:", validUntil() + " (14 days)"),
              infoRow("Prepared For:", client_name),
              infoRow("Property Address:", property_address),
              infoRow("Proposed Works:", works_description),
              infoRow("Adjoining Owners:", `${numAOs} adjoining owner${parseInt(numAOs) !== 1 ? 's' : ''} likely to be affected`),
            ]
          }),

          new Paragraph({
            spacing: { before: 360 },
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } },
            children: [new TextRun({ text: "Thank you for getting in touch regarding the above property. I set out below my fees for party wall surveying services in connection with the proposed works.", size: 19, font: "Arial", color: MID, italics: true })]
          }),

          // PART 1: FEE SCHEDULE
          h1("1.  Fee Schedule"),
          p("My fees depend on how your neighbour(s) respond to the party wall notice. The options are set out below."),
          new Paragraph({ spacing: { before: 120 }, children: [] }),

          new Table({
            width: { size: W, type: WidthType.DXA },
            columnWidths: [800, 6426, 1800],
            rows: [
              new TableRow({ children: [
                new TableCell({ borders: hdrBorders, shading: { fill: NAVY, type: ShadingType.CLEAR }, width: { size: 800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: "Stage", bold: true, size: 18, color: "FFFFFF", font: "Arial" })] })] }),
                new TableCell({ borders: hdrBorders, shading: { fill: NAVY, type: ShadingType.CLEAR }, width: { size: 6426, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: "Description", bold: true, size: 18, color: "FFFFFF", font: "Arial" })] })] }),
                new TableCell({ borders: hdrBorders, shading: { fill: NAVY, type: ShadingType.CLEAR }, width: { size: 1800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Fee", bold: true, size: 18, color: "FFFFFF", font: "Arial" })] })] }),
              ]}),
              feeRow("1", `Preparation and service of the Party Wall Notice on ${numAOs} adjoining owner${parseInt(numAOs) !== 1 ? 's' : ''}. This covers our initial consultation, preparation of the statutory notice, and formal service on all affected owners.`, fmt(fee_notice), false),
              new TableRow({ children: [
                new TableCell({ borders: hdrBorders, shading: { fill: LIGHT, type: ShadingType.CLEAR }, columnSpan: 3, width: { size: W, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: `Following service of the notice, the adjoining owner${parseInt(numAOs) !== 1 ? 's' : ''} have three options:`, bold: true, size: 18, color: NAVY, font: "Arial" })] })] }),
              ]}),
              feeRow("2A", `Consent. The adjoining owner${parseInt(numAOs) !== 1 ? 's' : ''} consent to the works in writing. No further action is required.`, "No further fee", false),
              feeRow("2B", `Consent subject to Schedule of Conditions. My fee covers the inspection, photography, and preparation of the written Schedule of Conditions report.`, fmt(fee_soc), true),
              feeRow("2C", `Dissent and appointment as Agreed Surveyor. My fee covers preparation and service of the Party Wall Award and all associated correspondence. This is the most cost-effective route for both parties.`, fmt(fee_agreed), false),
              feeRow("2D", `Dissent and separate surveyors. If the adjoining owner${parseInt(numAOs) !== 1 ? 's' : ''} appoint${parseInt(numAOs) !== 1 ? '' : 's'} ${parseInt(numAOs) !== 1 ? 'their' : 'their'} own surveyor, my fee remains ${fmt(fee_agreed)} as set out in Stage 2C above, plus an additional ${fmt(fee_separate)} to act as your appointed surveyor and negotiate directly with the adjoining owner's surveyor. The adjoining owner's own surveyor's fees are also payable by you, in addition to the above.`, `+${fmt(fee_separate)}`, true),
              new TableRow({ children: [
                new TableCell({ borders: hdrBorders, shading: { fill: NAVY, type: ShadingType.CLEAR }, width: { size: 800, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [] })] }),
                new TableCell({ borders: hdrBorders, shading: { fill: NAVY, type: ShadingType.CLEAR }, width: { size: 6426, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: "Maximum fee payable to us (worst case: Stage 1 + Stage 2C + Stage 2D addition)", bold: true, size: 19, color: "FFFFFF", font: "Arial" })] })] }),
                new TableCell({ borders: hdrBorders, shading: { fill: NAVY, type: ShadingType.CLEAR }, width: { size: 1800, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmt(maxTotal), bold: true, size: 20, color: "FFFFFF", font: "Arial" })] })] }),
              ]}),
            ]
          }),

          new Paragraph({ spacing: { before: 120 } }),

          // PART 2: INCLUDED
          h1("2.  What Is Included"),
          bullet("Initial consultation and review of drawings and proposed works"),
          bullet("Assessment of which party wall notices are required and on which adjoining owners"),
          bullet("Preparation and formal service of all required notices under the Party Wall etc. Act 1996"),
          bullet("Continuous dialogue and liaison with the building owner's design team including the architect, structural engineer, and any other consultants throughout the party wall process"),
          bullet("Ongoing party wall advice to the building owner throughout the works"),
          bullet("Liaison with adjoining owners and their representatives throughout the process"),
          bullet("Preparation of the Party Wall Award (if required), setting out the conditions under which works may proceed"),
          bullet("Site inspection(s) as required during and after the works"),
          bullet("Schedule of Conditions survey and report (if applicable)"),

          // PART 3: ADDITIONAL NOTES
          h1("3.  Additional Notes"),
          h2("Multiple Adjoining Owners"),
          p("Where there is more than one adjoining owner affected, the fees above apply per notice served. We will confirm the total fee in writing before proceeding."),
          h2("Adjoining Owner's Surveyor's Fees"),
          p("Where the adjoining owner appoints their own surveyor (Stage 2D), their reasonable fees are also payable by you. These are outside our control and will vary depending on the surveyor appointed. We will keep you informed as the matter progresses."),
          h2("Disbursements"),
          p("Any third-party costs such as postage, Land Registry searches, or specialist reports will be charged at cost with your prior approval."),

          // PART 4: TERMS
          h1("4.  Terms"),
          bullet("This quotation is valid for 14 days from the date of issue."),
          bullet("Works must not commence until all required party wall notices have been properly served and the relevant statutory periods have elapsed."),
          bullet("Our fees are payable in accordance with the payment terms agreed at the time of instruction."),

          // PART 5: NEXT STEPS
          h1("5.  Next Steps"),
          p("Please confirm your acceptance of this quotation by reply email. Once instructed, we will:"),
          bullet("Carry out a full review of your drawings and confirm which notices are required"),
          bullet("Confirm the total fee in writing where multiple adjoining owners are involved"),
          bullet("Contact you to arrange service of the notice(s)"),
          bullet("Keep you informed at every stage of the process"),

          new Paragraph({ spacing: { before: 360 } }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } },
            spacing: { before: 240 },
            children: [new TextRun({ text: "Square One Consulting  |  help@sq1consulting.co.uk  |  07889 996 841", size: 17, font: "Arial", color: "#9ca3af" })]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Generated by Nora", size: 15, font: "Arial", color: "#d1d5db" })]
          }),
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const base64 = buffer.toString('base64');

    return res.status(200).json({
      success: true,
      quote_ref: ref,
      file_name: `Party_Wall_Fee_Quote_${ref}.docx`,
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      base64,
    });

  } catch (err) {
    console.error('[generate-fee-quote]', err);
    return res.status(500).json({ error: err.message });
  }
}
