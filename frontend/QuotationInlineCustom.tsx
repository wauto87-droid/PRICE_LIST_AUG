"use client";
import { useRef, useState } from 'react';
import { api, type Translate } from './api';
import { customEntryLine, entryMatchLine } from './quotation-entry';
import { humanizeCustomLineError } from './custom-line-errors';
import { wheelSafeNumberInputProps } from './number-input';

export default function QuotationInlineCustom({ t, query, quantity, vat, disabled, onAdd, onCancel, onBusy }: {
  t: Translate; query: string; quantity: string; vat: string; disabled: boolean;
  onAdd: (line: any) => void; onCancel: () => void;
  onBusy: (value: boolean) => void;
}) {
  const [value, setValue] = useState({ partNumber: query, description: '', unit: 'pcs', quantity, unitPriceExcl: '', discount: '0' });
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function add() {
    if (disabled || submitting.current) return;
    submitting.current = true; setBusy(true); onBusy(true); setError(''); setDuplicate(null);
    try {
      const line = customEntryLine(value, vat);
      if (value.partNumber.trim()) {
        const products = await api<any[]>('search?q=' + encodeURIComponent(value.partNumber.trim()));
        if (products.some(item => String(item.partNumber).trim().toUpperCase() === value.partNumber.trim().toUpperCase()))
          throw new Error(t('This reference belongs to a catalogue product. Select it from item search.', 'هذا المرجع لصنف في الكتالوج. اختره من البحث.'));
      }
      const result = await api('reusable-custom-items/resolve', 'POST', { reference: value.partNumber.trim(), description: value.description.trim() });
      if (result.match) { setDuplicate(result.match); return; }
      onAdd(line);
    } catch (reason) { setError(humanizeCustomLineError((reason as Error).message)); }
    finally { submitting.current = false; setBusy(false); onBusy(false); }
  }
  return <div className="quotation-inline-custom" role="group" aria-label={t('New custom item', 'صنف مخصص جديد')}>
    <strong>{t('Add custom item', 'إضافة صنف مخصص')}</strong>
    <div className="quotation-custom-fields">
      {([['partNumber', 'Reference', 'المرجع'], ['description', 'Description', 'الوصف'], ['unit', 'Unit', 'الوحدة'],
        ['quantity', 'Quantity', 'الكمية'], ['unitPriceExcl', 'Unit price excl. VAT', 'سعر الوحدة قبل الضريبة']] as const).map(([key, en, ar]) =>
        <label key={key}>{t(en, ar)}<input autoFocus={key === 'description'} value={value[key]} maxLength={key === 'description' ? 1000 : key === 'unit' ? 20 : 100}
          disabled={disabled || busy} type={['quantity', 'unitPriceExcl'].includes(key) ? 'number' : 'text'} step="any"
          {...wheelSafeNumberInputProps} onChange={event => { setValue({ ...value, [key]: event.target.value }); setDuplicate(null); }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add(); } }}/></label>)}
      <button type="button" className="primary" disabled={disabled || busy} onClick={() => void add()}>{busy ? t('Checking…', 'جارٍ الفحص…') : t('Add & reuse', 'إضافة وإعادة استخدام')}</button>
      <button type="button" disabled={busy} onClick={onCancel}>{t('Cancel', 'إلغاء')}</button>
    </div>
    <small>{t('Saved for future searches when you save the quotation.', 'يُحفظ للبحث مستقبلاً عند حفظ عرض السعر.')}</small>
    {duplicate && <div role="status">{t('A saved custom item already exists:', 'يوجد صنف مخصص محفوظ:')} {duplicate.reference} — {duplicate.description}
      <button type="button" disabled={disabled || busy} onClick={async () => {
        try { onAdd(await entryMatchLine({ source: 'CUSTOM', item: duplicate }, value.quantity, vat)); }
        catch (reason) { setError(humanizeCustomLineError((reason as Error).message)); }
      }}>{t('Use saved item', 'استخدام الصنف المحفوظ')}</button></div>}
    {error && <p className="sales-check-error" role="alert">{error}</p>}
  </div>;
}
