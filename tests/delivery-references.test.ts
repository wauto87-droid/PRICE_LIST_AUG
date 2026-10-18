import test from "node:test";
import assert from "node:assert/strict";
import { deliveryReference, deliveryCustomerReferences } from "../shared/delivery-references";
const line = (rowId:string, docNo:string, docDate:string) => ({input:{importMeta:{source:"DELIVERY_NOTE",rowId,docNo,docDate}}});
test("delivery references follow remaining rows and preserve manual notes", () => {
 const rows=[line("a","100","2026-10-01"),line("b","100","2026-10-01"),line("c","200","2026-10-02")];
 const customer={reference:"Delivery notes: 100, 200",notes:"Manual note\nDelivery dates: 2026-10-01, 2026-10-02\nImported from delivery notes: 100, 200\nCustomer instructions"};
 assert.equal(deliveryCustomerReferences(customer,rows.slice(1),rows).reference,customer.reference);
 const next=deliveryCustomerReferences(customer,[rows[2]],rows);
 assert.equal(next.reference,"Delivery notes: 200");
 assert.equal(next.notes,"Manual note\nDelivery dates: 2026-10-02\nImported from delivery notes: 200\nCustomer instructions");
 assert.equal(deliveryCustomerReferences(customer,[],rows).notes,"Manual note\nCustomer instructions");
 assert.deepEqual(deliveryCustomerReferences(customer,[rows[2],rows[1]],rows),{...customer,reference:"Delivery notes: 200, 100",notes:"Manual note\nDelivery dates: 2026-10-02, 2026-10-01\nImported from delivery notes: 200, 100\nCustomer instructions"});
 assert.equal(deliveryCustomerReferences({...customer,reference:"Manual reference"},[rows[2]],rows).reference,"Manual reference");
});


test("long delivery references stay within the customer limit through removal and restore", () => {
 const rows=Array.from({length:61},(_,index)=>line(String(index),String(1852+index),"2026-10-01"));
 const full=rows.map(row=>row.input.importMeta.docNo).join(", ");
 const customer={reference:deliveryReference(rows.map(row=>row.input.importMeta.docNo)),notes:"Manual note\nImported from delivery notes: "+full};
 assert.ok(customer.reference.length<=200);assert.match(customer.reference,/more.*see notes/);
 const unchanged=deliveryCustomerReferences(customer,rows);
 assert.equal(unchanged.reference,customer.reference);assert.equal(unchanged.notes,customer.notes);
 const shortened=deliveryCustomerReferences(customer,rows.slice(0,1),rows);
 assert.equal(shortened.reference,"Delivery notes: 1852");assert.equal(shortened.notes,"Manual note\nImported from delivery notes: 1852");
 assert.equal(deliveryCustomerReferences(shortened,rows,rows.slice(0,1)).notes,customer.notes);
 assert.equal(deliveryReference(["X".repeat(200)]),"Delivery notes: 1 reference(s) (see notes)");
});
