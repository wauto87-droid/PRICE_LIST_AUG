import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationBaseURL, parseRemoteResponse } from '../backend/integrations/core';

test('integration URLs normalize app homes and copied health URLs without changing origin or query',()=>{
 assert.equal(integrationBaseURL('https://erp.test/','workflow'),'https://erp.test/api/sales-workflow/integration/v1');
 assert.equal(integrationBaseURL('https://erp.test/api/sales-workflow/integration/v1/health','workflow'),'https://erp.test/api/sales-workflow/integration/v1');
 assert.equal(integrationBaseURL('https://price.test/amt_price_list/','pricelist'),'https://price.test/amt_price_list/api/v1/integration/v1');
 assert.equal(integrationBaseURL('https://erp.test/api/sales-workflow/integration/v1/','workflow'),'https://erp.test/api/sales-workflow/integration/v1');
 assert.equal(integrationBaseURL('https://erp.test/custom/api/sales-workflow/integration/v1','workflow'),'https://erp.test/custom/api/sales-workflow/integration/v1');
 assert.equal(new URL(integrationBaseURL('https://erp.test/?unsafe=yes','workflow')).search,'?unsafe=yes');
});

test('HTML, redirects, invalid JSON and server errors explain the failed staff request without exposing page contents',()=>{
 const cases:[[number,string,string],string,string][]=[
 [[200,'text/html','<html>secret-page</html>'],'ENDPOINT_REQUIRED','HTML page'],
 [[307,'text/html',''],'ENDPOINT_REQUIRED','redirected'],
 [[404,'text/html','not found'],'ENDPOINT_REQUIRED','endpoint not found'],
 [[502,'text/html','bad gateway'],'ERP_UNAVAILABLE','Remote server unavailable'],
 [[401,'text/html','login'],'AUTHENTICATION_FAILED','Authentication failed'],
 [[503,'application/json','{"error":"Pricing & Collection Jobs integration is disabled"}'],'INTEGRATION_DISABLED','disabled'],
 [[403,'application/json','{"error":"Admin mapping required: user missing"}'],'MAPPING_REQUIRED','mapping'],
 [[200,'application/json','null'],'UPDATE_REQUIRED','JSON object'],
 [[200,'application/json','[]'],'UPDATE_REQUIRED','JSON object']
 ];
 for(const [input,code,message] of cases)assert.throws(()=>parseRemoteResponse(...input),(e:any)=>{assert.equal(e.code,code);assert.match(e.message,new RegExp(message,'i'));assert(!e.message.includes('secret-page'));return true;});
 const result={staff:[{id:'staff-id',name:'Ahmed'}],branchId:'AMT'};
 assert.deepEqual(parseRemoteResponse(200,'application/json','\uFEFF'+JSON.stringify(result)),result);
 assert.throws(()=>parseRemoteResponse(401,'application/json','{"error":"swk_abcdef missing permission"}'),(e:any)=>!e.message.includes('swk_abcdef'));
});
