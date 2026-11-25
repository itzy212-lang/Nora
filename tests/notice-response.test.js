import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { makePdf } from '../api/_lib/notice-response-documents.js';
import publicNotice from '../api/notice-response-public.js';
import submit from '../api/notice-response-submit.js';
import verify from '../api/notice-response-verify.js';

function mockResponse(){
 return {
  statusCode:200, headers:{}, body:null,
  setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},
  status(s){this.statusCode=s;return this;},
  json(b){this.body=b;return this;}
 };
}
test('acknowledgement PDF has a valid PDF signature and one page',async()=>{
 const bytes=await makePdf('Party Wall Notice Response',[['Signer','Test Signatory'],['Choice','Consent']]);
 assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 const pdf=await PDFDocument.load(bytes);
 assert.equal(pdf.getPageCount(),1);
});
test('public notice rejects malformed token without database access',async()=>{
 const res=mockResponse();
 await publicNotice({method:'GET',query:{token:'invalid'}},res);
 assert.equal(res.statusCode,404);
 assert.equal(res.headers['cache-control'],'no-store');
});
test('public notice refuses unsupported method',async()=>{
 const res=mockResponse();
 await publicNotice({method:'POST'},res);
 assert.equal(res.statusCode,405);
});
test('submission and verification refuse GET',async()=>{
 for(const handler of [submit,verify]){
  const res=mockResponse();
  await handler({method:'GET'},res);
  assert.equal(res.statusCode,405);
 }
});
test('verification rejects malformed code before database access',async()=>{
 const res=mockResponse();
 await verify({method:'POST',body:{token:'A'.repeat(32),submissionId:'12345678-1234-1234-1234-123456789abc',code:'12345'}},res);
 assert.equal(res.statusCode,400);
});
