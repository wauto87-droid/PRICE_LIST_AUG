'use client';
import Decimal from 'decimal.js';
import { displayDate, fieldNames, type DNLine } from '../../shared/dn-tracker';
import type { Translate } from '../api';

export default function DuplicateReview({ groups, busy, choose, t }: {
  groups: { id: string; rows: DNLine[]; decision: string | null }[];
  busy: boolean; choose: (id: string, choice: string) => void; t: Translate;
}) {
  if (!groups.length) return null;
  return <section className="dn-duplicate-review" aria-label={t('Review repeated rows', 'مراجعة الصفوف المتكررة')}>
    <h3>{t('Review repeated rows', 'مراجعة الصفوف المتكررة')}</h3>
    <p>{t('Identical lines may be separate deliveries. Choose what to include; your Excel file stays unchanged.', 'قد تكون الصفوف المتطابقة عمليات تسليم منفصلة. اختر ما تريد تضمينه؛ لن يتغير ملف Excel.')}</p>
    {groups.map(group => {
      const first = group.rows[0];
      const total = group.rows.reduce((sum, row) => sum.add(row.balance), new Decimal(0)).toString();
      return <article className="dn-duplicate-group" key={group.id}>
        <h4>{first.customer} · {t('DN', 'إذن')} {first.docNo} · {displayDate(first.date)}</h4>
        <p>{first.itemCode} · {first.itemName}</p>
        <div className="dn-duplicate-lines">{group.rows.map(row => <div key={row.row} className="dn-duplicate-line">
          <strong>{t('Source row', 'صف المصدر')} {row.row}</strong>
          <dl>{(['qty', 'invoiced', 'invoiceRet', 'deliveryRet', 'balance'] as const).map(field => <div key={field}><dt>{t(...fieldNames[field])}</dt><dd>{row[field]} {row.unit}</dd></div>)}</dl>
        </div>)}</div>
        <label>{t('Action for rows', 'إجراء الصفوف')} {group.rows.map(r => r.row).join(', ')}
          <select value={group.decision || ''} disabled={busy} onChange={e => choose(group.id, e.target.value)}>
            <option value="" disabled>{t('Choose an action', 'اختر إجراءً')}</option>
            <option value="KEEP_ALL">{t('Keep all', 'الاحتفاظ بالجميع')} · {total} {first.unit}</option>
            <option value="KEEP_FIRST">{t('Keep first only', 'الاحتفاظ بالأول فقط')} · {first.balance} {first.unit}</option>
          </select>
        </label>
      </article>;
    })}
  </section>;
}
