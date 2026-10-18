"use client";
import { useEffect, useRef, useState } from 'react';
import type { Translate } from './api';
import QuotationItemSearch from './QuotationItemSearch';
import QuotationInlineCustom from './QuotationInlineCustom';
import { entryMatchLine, validEntryQuantity, type EntryMatch } from './quotation-entry';
import { wheelSafeNumberInputProps } from './number-input';

export default function QuotationEntryDraft({ t, row, vat, disabled, onAdd, onBusy, compact = false }: {
  compact?: boolean; t: Translate; row: number; vat: string; disabled: boolean;
  onAdd: (line: any, restoreQuantity: boolean) => void; onBusy: (value: boolean) => void;
}) {
  const [match, setMatch] = useState<EntryMatch | null>(null);
  const [quantity, setQuantity] = useState('');
  const [customQuery, setCustomQuery] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const quantityInput = useRef<HTMLInputElement>(null);
  const latestAdd = useRef(onAdd); latestAdd.current = onAdd;
  const finished = useRef(false);
  useEffect(() => {
    if (!match || !validEntryQuantity(quantity) || disabled || finished.current) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true); onBusy(true); setError('');
      try {
        const line = await entryMatchLine(match, quantity, vat);
        if (!cancelled && !finished.current) {
          finished.current = true;
          latestAdd.current(line, document.activeElement === quantityInput.current);
        }
      } catch (reason) { if (!cancelled) setError((reason as Error).message); }
      finally { if (!cancelled) { setBusy(false); onBusy(false); } }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); setBusy(false); onBusy(false); };
  }, [match, quantity, vat, disabled, onBusy]);
  const label = match ? (match.source === 'CATALOG' ? match.item.partNumber : match.item.reference || t('Custom', 'مخصص')) : '';
  return <>
    <tr className="quotation-draft-row" data-entry-draft>
      {!compact && <td>{row}</td>}
      <td><QuotationItemSearch t={t} label={label} row={row} disabled={disabled || busy}
        onSelect={async result => { setMatch(result); setCustomQuery(null); setError(''); }}
        onCustom={query => { setMatch(null); setCustomQuery(query); }}/>
        {compact && <><small>{match?.item.description || t('Next item', 'الصنف التالي')} · {match?.item.unit || '—'}</small>{error && <small role="alert" className="sales-check-error">{error}</small>}{busy && <small role="status">{t('Loading price…','جارٍ تحميل السعر…')}</small>}</>}</td>
      {!compact && <><td>{match?.item.description || <span className="muted">{t('Next item', 'الصنف التالي')}</span>}
        {error && <small className="sales-check-error" role="alert">{error}</small>}
        {busy && <small role="status">{t('Loading price…', 'جارٍ تحميل السعر…')}</small>}</td>
      <td>{match?.item.unit || '—'}</td></>}
      <td><input ref={quantityInput} data-cart-field="quantity" aria-label={t('New item quantity', 'كمية الصنف الجديد')} type="number"
        min="0.000001" step="any" {...wheelSafeNumberInputProps} value={quantity} disabled={disabled}
        onChange={event => setQuantity(event.target.value)}/></td>
      <td>—</td><td>—</td><td>—</td><td></td>
    </tr>
    {customQuery !== null && <tr className="quotation-custom-row"><td colSpan={compact ? 6 : 9}>
      <QuotationInlineCustom key={customQuery} t={t} query={customQuery} quantity={validEntryQuantity(quantity) ? quantity : '1'}
        vat={vat} disabled={disabled} onBusy={onBusy} onCancel={() => setCustomQuery(null)}
        onAdd={line => { if (!finished.current) { finished.current = true; onAdd(line, false); } }}/>
    </td></tr>}
  </>;
}
