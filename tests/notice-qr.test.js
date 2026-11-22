import test from 'node:test';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import { insertNoticeQr, noticeQrSentinel } from '../api/_lib/notice-qr.js';

test('notice QR is embedded as a valid DOCX drawing and media relationship',async()=>{
 const zip=new PizZip();
 zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+noticeQrSentinel+'</w:t></w:r></w:p></w:body></w:document>');
 zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex'),Buffer.alloc(64)]);
 const original=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>png});
 try{
  const url='https://notices.sq1consulting.co.uk/respond/'+'a'.repeat(32);
  const bytes=await insertNoticeQr(zip.generate({type:'nodebuffer'}),url);
  const result=new PizZip(bytes);
  const xml=result.file('word/document.xml').asText();
  const rel=result.file('word/_rels/document.xml.rels').asText();
  assert.match(xml,/<w:drawing>/);
  assert.match(xml,/<wp:anchor/);
  assert.match(xml,/<wp:align>right<\/wp:align>/);
  assert.match(xml,/<wp:wrapSquare wrapText="left"\/>/);
  assert.match(xml,/<wp:extent cx="594360" cy="594360"\/>/);
  assert.doesNotMatch(xml,/NORA_NOTICE_QR_IMAGE_SENTINEL/);
  assert.match(rel,/relationships\/image/);
  assert.ok(result.file(/word\/media\/notice-response-qr-/).length===1);
  assert.match(result.file('[Content_Types].xml').asText(),/Extension="png"/);
 }finally{globalThis.fetch=original;}
});

test('QR placeholder shares a Word text run with the response URL',async()=>{
 const zip=new PizZip();
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Respond online: https://example.test '+noticeQrSentinel+' end</w:t></w:r></w:p></w:body></w:document>');
 zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex'),Buffer.alloc(64)]);
 const original=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>png});
 try{
  const result=new PizZip(await insertNoticeQr(zip.generate({type:'nodebuffer'}),'https://notices.sq1consulting.co.uk/n/121-N128AV-A1B2C3D4E5'));
  const xml=result.file('word/document.xml').asText();
  assert.match(xml,/Respond online: https:\/\/example.test/);
  assert.ok(xml.indexOf('Respond online:') < xml.indexOf('<w:drawing>'));
  assert.match(xml,/<w:drawing>/);
  assert.match(xml,/<wp:anchor/);
  assert.match(xml,/<wp:align>right<\/wp:align>/);
  assert.match(xml,/<wp:wrapSquare wrapText="left"\/>/);
  assert.match(xml,/end<\/w:t>/);
  assert.doesNotMatch(xml,/NORA_NOTICE_QR_IMAGE_SENTINEL/);
 }finally{globalThis.fetch=original;}
});
