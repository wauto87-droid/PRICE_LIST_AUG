import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedDraft, sharedDraftCommand } from '../shared/shared-draft';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Actions from '../frontend/SharedQuotationActions';
const offer={id:'offer',supplier:'shop',cost:'5',currency:'SAR',unit:'pcs',taxBasis:'No VAT',availability:'Available'};
const items=Array.from({length:10},(_,i)=>({id:`item-${i}`,partNumber:`P-${i}`,name:`Product ${i}`,quantity:'2',unit:'pcs',offers:i<2?[{...offer,id:`offer-${i}`}]:[],selectedOffer:i<2?`offer-${i}`:'',confirmableQuantity:'2'}));
const result={requestId:'req',number:'DR-0060',requestRevision:1,customer:'Buyer',ownerId:'owner',actorId:'owner',suppliers:[{id:'shop',name:'Shop'}],collectionStaff:[],items,quotations:[],orders:[]};
test('ten-item draft remains complete and quotation modes explicitly select ten or two',()=>{
 const edit=sharedDraft(result);assert.equal(edit.lines.length,10);
 const all=sharedDraft(result,undefined,undefined,'all');assert.equal(all.lines.length,10);assert.equal(all.lines[2].input.unitPriceExcl,'');assert.equal(all.lines[2].workflowCost,undefined);
 assert.throws(()=>sharedDraftCommand(all),/selling price/);
 all.lines.forEach((l:any)=>l.input.unitPriceExcl='0');const command=sharedDraftCommand(all);assert.equal(command.lines[2].offerId,undefined);assert.equal(command.lines[2].sellingPrice,'0');
 const priced=sharedDraft(result,undefined,undefined,'priced');assert.equal(priced.lines.length,2);assert.equal(priced.sharedOmittedItems.length,8);
 const removed={...result,items:items.map((i,index)=>({...i,active:index!==9}))};assert.equal(sharedDraft(removed).lines.length,9);
});
test('expired and unavailable offers are excluded without inventing a zero cost',()=>{
 const unavailable={...result,items:[{...items[0],offers:[{...offer,availability:'unavailable'}]},{...items[1],offers:[{...offer,validUntil:'2000-01-01'}]}]};
 assert.equal(sharedDraft(unavailable,undefined,undefined,'priced').lines.length,0);assert.equal(sharedDraft(unavailable).lines[0].workflowCost,undefined);
});
test('three actions, price table, version-bound print and checked quantity table render',()=>{
 const row:any={...result,id:'req',quotations:[{version:1,customer:'Buyer',currency:'SAR',total:'10',subtotal:'10',taxTotal:'0',lines:[{itemId:'item-0',name:'Product 0',partNumber:'P-0',unit:'pcs',quantity:'2',confirmableQuantity:'1',sellingPrice:'5',offer:null}]}]};
 const html=renderToStaticMarkup(createElement(Actions,{row,data:result,busy:false,showFulfillment:true,submit:async()=>true,onOpenDraft(){},onPdf(){}}));
 assert.match(html,/Edit draft \(10\)/);assert.match(html,/all items \(10\)/);assert.match(html,/priced items \(2\)/);assert.match(html,/Supplier price/);assert.match(html,/Accepted quantity/);assert.match(html,/Select all eligible/);assert.match(html,/value="1"/);assert.match(html,/Confirm selected items/);assert.match(html,/version=1/);assert.doesNotMatch(html,/name="owner:item/);
});

test('placeholder zero prices stay blank, while explicitly entered zero remains valid',()=>{
 const one={...result,items:[{...items[2],localLineId:'local'}]};
 const source={lines:[{input:{watcherEventId:'local'},price:{finalExcl:'0'}}]};
 assert.equal(sharedDraft(one,source).lines[0].input.unitPriceExcl,'');
 source.lines[0].input={...source.lines[0].input,unitPriceExcl:'0'} as any;
 const explicit=sharedDraft(one,source);assert.equal(explicit.lines[0].input.unitPriceExcl,'0');assert.equal(sharedDraftCommand(explicit).lines[0].sellingPrice,'0');
});
