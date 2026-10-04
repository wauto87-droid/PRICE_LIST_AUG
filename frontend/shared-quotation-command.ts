export type PendingQuotationCommand = { fingerprint: string; eventId: string; payload: Record<string, any> };

export function quotationCommandRejected(error: unknown) {
  return [400, 403, 404, 409, 422].includes(Number((error as any)?.status));
}

/** Keep both identity and original revision after an uncertain response or background refresh. */
export function pendingQuotationCommand(previous: PendingQuotationCommand | null, payload: Record<string, any>, newId: () => string): PendingQuotationCommand {
  const { revision: _revision, ...intent } = payload;
  const fingerprint = JSON.stringify(intent);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, eventId: newId(), payload: structuredClone(payload) };
}
