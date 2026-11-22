import PizZip from 'pizzip';

const SENTINEL='NORA_NOTICE_QR_IMAGE_SENTINEL_948271';
const escapeXml=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/** Embed an image into the actual DOCX media and relationships, not a linked image. */
export async function insertNoticeQr(docxBuffer, url) {
 if(!/^https:\/\/[a-z0-9.-]+\/respond\/[A-Za-z0-9_-]{32}$/.test(url))
  throw Error('A valid unique notice response URL is required');
 const zip=new PizZip(docxBuffer);
 let xml=zip.file('word/document.xml')?.asText();
 if(!xml||!xml.includes(SENTINEL))return docxBuffer;
 const response=await fetch('https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=png&margin=12&data='+encodeURIComponent(url),{signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Could not generate notice response QR code');
 const png=Buffer.from(await response.arrayBuffer());
 if(png.length<100||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')
  throw Error('QR code service did not return a valid PNG');
 const relPath='word/_rels/document.xml.rels';
 const relFile=zip.file(relPath);
 if(!relFile)throw Error('Word template relationships missing');
 let rels=relFile.asText();
 const ids=[...rels.matchAll(/Id="rId(\d+)"/g)].map(m=>Number(m[1]));
 const rid='rId'+(Math.max(0,...ids)+1);
 const filename='notice-response-qr-'+Date.now()+'.png';
 zip.file('word/media/'+filename,png);
 rels=rels.replace('</Relationships>',`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/></Relationships>`);
 zip.file(relPath,rels);
 let types=zip.file('[Content_Types].xml')?.asText();
 if(!types)throw Error('Word content types missing');
 if(!/Extension="png"/i.test(types))types=types.replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>');
 zip.file('[Content_Types].xml',types);
 const drawing=`<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="594360" cy="594360"/><wp:docPr id="948271" name="Notice response QR code"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Notice response QR"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="594360" cy="594360"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
 const matches=(xml.match(new RegExp(SENTINEL,'g'))||[]).length;
 if(matches!==1)throw Error('QR placeholder must appear exactly once in the Word template');
 // Word often keeps the QR placeholder in the same text run as the URL or a space.
 // Split the text run around the image rather than requiring a dedicated run.
 const textNode=/<w:t([^>]*)>([^<]*)<\/w:t>/g;
 let inserted=0;
 xml=xml.replace(textNode,(whole,attrs,content)=>{
  if(!content.includes(SENTINEL))return whole;
  inserted++;
  const [before,after]=content.split(SENTINEL);
  const open='<w:t'+attrs+'>';
  const pieces=[];
  if(before)pieces.push(open+before+'</w:t>');
  pieces.push('</w:r><w:r>'+drawing+'</w:r><w:r>');
  if(after)pieces.push(open+after+'</w:t>');
  return pieces.join('');
 });
 if(inserted!==1||xml.includes(SENTINEL))throw Error('Could not place QR image into Word text');
 zip.file('word/document.xml',xml);
 return zip.generate({type:'nodebuffer',compression:'DEFLATE'});
}
export const noticeQrSentinel=SENTINEL;
