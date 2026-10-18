"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type Translate } from './api';
import type { EntryMatch } from './quotation-entry';

export default function QuotationItemSearch({ t, label, row, disabled, onSelect, onCustom }: {
  t: Translate; label: string; row: number; disabled: boolean;
  onSelect: (match: EntryMatch) => Promise<void>; onCustom: (query: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(label);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<EntryMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 360, maxHeight: 240, transform: 'none' });
  const generation = useRef(0);
  const selecting = useRef(false);
  useEffect(() => { if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, id]);
  useEffect(() => { generation.current++; setQuery(label); setOpen(false); setResults([]); setError(''); }, [label]);
  useEffect(() => {
    if (!open || !query.trim() || disabled) return;
    const current = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const q = encodeURIComponent(query.trim());
        const [catalog, custom] = await Promise.all([
          api<any[]>('search?q=' + q, 'GET', undefined, { signal: controller.signal }),
          api<any[]>('reusable-custom-items?q=' + q, 'GET', undefined, { signal: controller.signal }),
        ]);
        if (current !== generation.current || controller.signal.aborted) return;
        setResults([...catalog.map(item => ({ source: 'CATALOG' as const, item })),
          ...custom.map(item => ({ source: 'CUSTOM' as const, item }))]);
        setActive(-1);
      } catch (reason) {
        if (current === generation.current && !controller.signal.aborted) {
          setResults([]); setError((reason as Error).message);
        }
      } finally {
        if (current === generation.current && !controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open, disabled]);
  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(520, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 12;
      const above = below < 160 && rect.top > below;
      const height = Math.min(260, Math.max(100, above ? rect.top - 12 : below));
      setPosition({ top: above ? rect.top - 4 : rect.bottom + 4,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width, maxHeight: height,
        transform: above ? 'translateY(-100%)' : 'none' });
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const noMatch = !loading && !error && !results.length && !!query.trim();
  const count = results.length + (noMatch ? 1 : 0);
  async function choose(index: number) {
    if (selecting.current || disabled || loading || error) return;
    if (index === results.length && noMatch) {
      onCustom(query.trim()); setOpen(false); return;
    }
    if (!results[index]) return;
    selecting.current = true; setBusy(true); setError('');
    try { await onSelect(results[index]); setOpen(false); }
    catch (reason) { setError((reason as Error).message); }
    finally { selecting.current = false; setBusy(false); }
  }
  return <div className="quotation-item-search">
    <input ref={input} data-cart-field="search" role="combobox" aria-label={t('Item search', 'بحث الصنف') + ' ' + row}
      aria-autocomplete="list" aria-expanded={open && !!query.trim()} aria-controls={id}
      aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
      autoComplete="off" value={query} disabled={disabled || busy} maxLength={100}
      placeholder={t('Search code or item name…', 'ابحث بالرمز أو اسم الصنف…')}
      onChange={event => { generation.current++; setQuery(event.target.value); setResults([]); setActive(-1); setLoading(true); setError(''); setOpen(true); }}
      onBlur={() => { if (!selecting.current) { setOpen(false); setQuery(label); } }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(label); }
        if (event.key === 'Tab') { setOpen(false); setQuery(label); }
        if (open && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
        }
        if (!open || loading) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setActive(value => count ? (value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count : -1);
        }
        if (event.key === 'Enter') { event.preventDefault(); void choose(active >= 0 ? active : 0); }
      }}/>
    {open && !!query.trim() && createPortal(<div className="quotation-search-popup" style={{ position: 'fixed', ...position }}
      onPointerDown={event => event.preventDefault()}>
      <div id={id} role="listbox" aria-label={t('Matching items', 'الأصناف المطابقة')}>
        {loading && <p role="status">{t('Searching catalogue and saved custom items…', 'جارٍ البحث في الكتالوج والأصناف المخصصة…')}</p>}
        {!loading && results.map((result, index) => <button type="button" role="option" tabIndex={-1}
          id={`${id}-${index}`} key={result.source + result.item.id} aria-selected={active === index}
          disabled={busy} onClick={() => void choose(index)}>
          <strong>{result.source === 'CATALOG' ? result.item.partNumber : result.item.reference || t('Custom', 'مخصص')}</strong>
          <span>{result.item.description}</span><small>{result.source === 'CATALOG' ? t('Catalogue', 'الكتالوج') : t('Saved custom', 'مخصص محفوظ')}</small>
        </button>)}
        {noMatch && <><p>{t('No matching item found.', 'لم يتم العثور على صنف مطابق.')}</p>
          <button type="button" role="option" tabIndex={-1} id={`${id}-0`} aria-selected={active === 0}
            onClick={() => void choose(0)}>+ {t('Add custom item', 'إضافة صنف مخصص')}: {query}</button></>}
      </div>
      {error && <p className="sales-check-error" role="alert">{error}</p>}
    </div>, document.body)}
  </div>;
}
