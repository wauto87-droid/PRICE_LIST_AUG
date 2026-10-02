import { DB, one } from '../core/db';
import { Actor } from '../auth/service';
import { check, authenticate, readBody } from './core';
import { receipt, workflowEnabled } from './job-protocol';
import { audit } from '../core/audit';
import { z } from 'zod';

export async function assertWorkflowOwner(db:DB,actor:Actor,q:any){
 const link=await one(db,'SELECT data FROM sw_job_documents WHERE id=$1',[q.id]);
 if(!link)return;
 check(!link.data.handover,'Ownership handover is pending synchronization',409);
 if(q.owner_id===actor.id)return;
 const grant=link.data.overrides?.[actor.id];
 check(actor.role==='ADMIN'&&grant?.reason&&Date.parse(grant.until)>Date.now(),'Only the responsible owner can change this document. Administrators must record an override reason in Pricing & Collection Jobs.',403);
 await audit(db,actor.id,'WORKFLOW_OWNER_OVERRIDE','quotations',q.id,null,{reason:grant.reason,owner:q.owner_id});
}
export async function ownershipEndpoint(db:DB,req:Request){
 workflowEnabled();await authenticate(db,req,'jobs:results');check(req.method==='POST','Method not allowed',405);
 const input=z.object({eventId:z.string().min(1),documentId:z.string().uuid(),transferId:z.string().uuid(),phase:z.enum(['prepare','complete']),oldOwnerId:z.string().uuid(),newOwnerId:z.string().uuid(),revision:z.number().int().nonnegative(),reason:z.string().trim().min(1).max(1000)}).parse(await readBody(req));
 return receipt(db,input.eventId,input,async tx=>{
  const q=await one(tx,'SELECT * FROM quotations WHERE id=$1 FOR UPDATE',[input.documentId]);check(q,'Document missing',404);
  const link=await one(tx,'SELECT * FROM sw_job_documents WHERE id=$1 FOR UPDATE',[q.id]);check(link,'Linked document missing',409);
  if(input.phase==='prepare'){
   check(!link.data.handover&&q.owner_id===input.oldOwnerId&&(link.data.ownershipRevision||0)===input.revision,'Ownership changed; refresh before handover',409);
   const target=await one(tx,'SELECT id FROM users WHERE id=$1 AND disabled IS NOT TRUE',[input.newOwnerId]);check(target,'New owner is inactive or missing',409);
   const outgoing=await one(tx,"SELECT id FROM sw_job_outbox WHERE endpoint='jobs-assign' AND payload->>'documentId'=$1 AND state<>'SENT' LIMIT 1",[q.id]);check(!outgoing,'Finish pending assignment synchronization before handover',409);
   link.data.originalCreatorId ||= q.owner_id;link.data.handover=input;
  }else{
   check(link.data.handover?.transferId===input.transferId,'Handover does not match',409);
   await tx.query('UPDATE quotations SET owner_id=$2,version=version+1,updated_at=now() WHERE id=$1',[q.id,input.newOwnerId]);
   link.data.ownershipRevision=input.revision+1;delete link.data.handover;delete link.data.overrides;
  }
  await tx.query('UPDATE sw_job_documents SET data=$2::jsonb,revision=revision+1 WHERE id=$1',[q.id,JSON.stringify(link.data)]);
  await audit(tx,input.phase==='prepare'?input.oldOwnerId:input.newOwnerId,'WORKFLOW_HANDOVER_'+input.phase.toUpperCase(),'quotations',q.id,{owner:input.oldOwnerId},{owner:input.newOwnerId,reason:input.reason,transferId:input.transferId});
  return {received:true,transferId:input.transferId,phase:input.phase};
 });
}
