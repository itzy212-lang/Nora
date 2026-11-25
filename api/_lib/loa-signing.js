import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const loaHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const loaToken = () => randomBytes(24).toString('base64url');
export const loaTokenHash = token => loaHash(Buffer.from(token));
/**
 * A signer's link, worked out from their id and a server-only secret instead of
 * being random. The database still stores only its one-way hash, but because
 * the link can be recalculated, a reminder can resend exactly the same link as
 * the original email, so there is never an old link and a new link in
 * circulation. Nobody without the server secret can work a link out.
 */
export const loaSignerToken = signerId => {
  const key = process.env.LOA_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error('Signing link secret not configured');
  return createHmac('sha256', key).update('loa-signer-link:' + signerId).digest('base64url').slice(0, 32);
};

/** A signer is invited only after the previous signer has verified their email. */
export function nextLOASigner(signers) {
  const ordered = [...signers].sort((a,b) => a.position - b.position);
  const next = ordered.find(s => s.status !== 'verified');
  if (!next) return null;
  return ordered.slice(0,ordered.indexOf(next)).every(s => s.status === 'verified') ? next : null;
}

export function validateLOASigners(signers) {
  if (!Array.isArray(signers) || signers.length < 1 || signers.length > 2) throw Error('An LOA requires one or two signatories');
  const seen = new Set();
  return signers.map((s,i) => {
    const email = String(s.email || '').trim().toLowerCase();
    const name = String(s.name || '').trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) throw Error('Each LOA signatory requires a unique valid email and name');
    seen.add(email);
    return { position:i+1, name, email, status:'pending' };
  });
}

/** Draw signatures into the existing LOA PDF without changing its underlying text or layout.
 *  Coordinates are PDF points measured from the bottom-left of the actual PDF page.
 *  The caller supplies positions mapped from the original LOA template, never guesses them.
 */
export async function stampLOASignatures(pdfBytes, signatures, placements) {
  const pdf = await PDFDocument.load(pdfBytes);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile(require.resolve('@fontsource/allura/files/allura-latin-400-normal.woff')), {subset:true});
  const dateFont = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  for (const s of signatures) {
    if (!s.verifiedAt || !s.signedDate) throw Error('Unverified signature cannot be applied');
    const place = placements[s.position];
    if (!place || !Number.isInteger(place.page) || !place.signature || !place.date) throw Error('LOA signature placement missing');
    const page = pdf.getPage(place.page);
    const { width, height } = page.getSize();
    for (const rect of [place.signature, place.date]) {
      if (![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite) || rect.x<0 || rect.y<0 || rect.width<=0 || rect.height<=0 || rect.x+rect.width>width || rect.y+rect.height>height) throw Error('LOA signature position is outside the page');
    }
    for(const key of ['signatureAnchor','dateAnchor'])if(place[key])page.drawRectangle({x:place[key].x-2,y:place[key].y-3,width:place[key].width+4,height:place[key].height+5,color:rgb(1,1,1)});
    const signature = String(s.signature || '').trim();
    if (!signature || signature.length>180) throw Error('Signature is missing or too long');
    const size = Math.min(29, place.signature.height*0.85, place.signature.width / Math.max(1,font.widthOfTextAtSize(signature,1)));
    page.drawText(signature,{x:place.signature.x,y:place.signature.y+4,size,font,color:rgb(.05,.13,.29)});
    page.drawText(String(s.signedDate),{x:place.date.x,y:place.date.y+3,size:Math.min(11,place.date.height*.7),font:dateFont,color:rgb(.1,.1,.1)});
  }
  return Buffer.from(await pdf.save());
}

/** The audit record is appended to the SAME PDF, never issued as a separate certificate. */
export async function appendLOAAuditPage(pdfBytes, {signers,documentHash,projectReference,appointmentType}) {
  if (!signers.length || signers.some(s => s.status!=='verified' || !s.verifiedAt)) throw Error('All signatories must be verified');
  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.addPage([595,842]);
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const draw=(label,value,y)=>{
    page.drawText(label,{x:45,y,size:10,font:bold});
    const v=String(value??'').replace(/[\r\n]/g,' ').slice(0,105);
    page.drawText(v,{x:45,y:y-16,size:10,font:regular});
  };
  page.drawText('ELECTRONIC SIGNATURE AUDIT RECORD',{x:45,y:790,size:17,font:bold,color:rgb(.08,.19,.34)});
  draw('Appointment',appointmentType.startsWith('bo_')?'Building Owner Letter of Appointment':'Adjoining Owners Letter of Appointment',747);
  draw('Project reference',projectReference,700);
  draw('Original LOA SHA-256',documentHash,653);
  let y=587;
  for (const signer of signers.sort((a,b)=>a.position-b.position)){
    page.drawText('SIGNER '+signer.position,{x:45,y,size:12,font:bold});
    y-=32;
    for (const [label,value] of [['Name',signer.name],['Verified email',signer.email],['Date entered',signer.signedDate],['Email verified (UTC)',signer.verifiedAt],['Verification method','Six-digit email one-time code']]){
      draw(label,value,y);y-=43;
    }
    y-=20;
  }
  if(y<40)throw Error('Too many signatories for audit page');
  return Buffer.from(await pdf.save());
}

/** Resolve PDF anchor positions from the actual generated document, rather than hardcoding page numbers. */
export async function locateLOAAnchors(pdfBytes, appointmentType, signerCount){
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:true,disableFontFace:true});
 const doc=await task.promise;
 const prefix=appointmentType.startsWith('ao_')?'AO':'BO';
 const placements={};
 for(let pageNumber=1;pageNumber<=doc.numPages;pageNumber++){
  const page=await doc.getPage(pageNumber);
  const content=await page.getTextContent();
  for(const item of content.items){
   if(typeof item.str!=='string')continue;
   for(let i=1;i<=signerCount;i++){
    const sign=prefix+'_'+i+'_SIGN_HERE',date=prefix+'_'+i+'_DATE_HERE';
    const key=item.str.includes(sign)?'signature':item.str.includes(date)?'date':null;
    if(!key)continue;
    const x=item.transform[4],y=item.transform[5];
    const target=placements[i]||(placements[i]={page:pageNumber-1});
    if(target.page!==pageNumber-1)throw Error('LOA anchors for a signatory must be on the same page');
    target[key]=key==='signature'?{x,y:y+14,width:Math.min(210,page.view[2]-x-12),height:34}:{x,y:y-2,width:Math.min(210,page.view[2]-x-12),height:18};
    target[key+'Anchor']={x,y,width:Math.max(item.width,100),height:14};
   }
  }
 }
 await task.destroy();
 for(let i=1;i<=signerCount;i++)if(!placements[i]?.signature||!placements[i]?.date)throw Error('The LOA template is missing signature or date anchors for signatory '+i);
 return placements;
}
