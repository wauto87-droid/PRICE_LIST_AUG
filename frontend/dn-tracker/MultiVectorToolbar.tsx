import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, BookmarkCheck, Upload, Download, Printer, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useTracker } from './TrackerContext';
import ExclusionsModal from './ExclusionsModal';
import { exportToExcelCsv, downloadHtmlReport } from './exportLogic';
import { OrderItem } from './types';

interface MultiVectorToolbarProps {
  activeItems: OrderItem[];
  allRawItems: OrderItem[];
  onUploadClick: () => void;
  onClearClick: () => void;
  onPrintPdfClick: () => void;
}

export default function MultiVectorToolbar({ activeItems, allRawItems, onUploadClick, onClearClick, onPrintPdfClick }: MultiVectorToolbarProps) {
  const { filters, updateFilter, presets, setPresets } = useTracker();
  const [localSearch, setLocalSearch] = useState(filters.searchQuery);
  const [showExclusions, setShowExclusions] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      updateFilter('searchQuery', localSearch);
    }, 150);
    return () => clearTimeout(timer);
  }, [localSearch, updateFilter]);

  const uniqueUnits = useMemo(() => {
    return Array.from(new Set(allRawItems.map(i => i.unit).filter(Boolean))).sort();
  }, [allRawItems]);

  const handleUpdatePreset = () => {
    if (!filters.activePresetId) return;
    setPresets(prev => prev.map(p => {
      if (p.id === filters.activePresetId) {
        return {
          ...p,
          excludedCompanies: filters.excludedCustomers
        };
      }
      return p;
    }));
    alert('Preset updated with current exclusions!');
  };

  const handleClearExclusions = () => {
    updateFilter('excludedCustomers', []);
  };

  const handleRemoveExclusion = (company: string) => {
    updateFilter('excludedCustomers', filters.excludedCustomers.filter(c => c !== company));
  };

  const toggleSortOrder = () => {
    updateFilter('sortOrder', filters.sortOrder === 'asc' ? 'desc' : 'asc');
  };

  return (
    <div className="mv-toolbar" style={{ position: 'sticky', top: 0, zIndex: 50, backgroundColor: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
      
      {/* TIER 1 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: '16px', borderBottom: '1px solid #f1f5f9' }}>
        
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: '#64748b' }} />
          <input 
            type="text" 
            placeholder="Search Doc No, Customer, Item Code/Name..." 
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 32px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          />
          {localSearch && (
            <button onClick={() => setLocalSearch('')} style={{ position: 'absolute', right: '10px', top: '10px', background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={16} color="#64748b" />
            </button>
          )}
        </div>

        {/* Preset Selector */}
        <select 
          value={filters.activePresetId || ''} 
          onChange={(e) => {
            const val = e.target.value;
            updateFilter('activePresetId', val || null);
            if (val) {
              const preset = presets.find(p => p.id === val);
              if (preset) {
                updateFilter('excludedCustomers', preset.excludedCompanies);
              }
            }
          }}
          style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
        >
          <option value="">No Preset (Show All)</option>
          {presets.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Update Preset */}
        <button 
          onClick={handleUpdatePreset}
          disabled={!filters.activePresetId}
          style={{ 
            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', 
            borderRadius: '6px', border: '1px solid #cbd5e1', 
            backgroundColor: filters.activePresetId ? '#f0fdf4' : '#f1f5f9',
            color: filters.activePresetId ? '#166534' : '#94a3b8',
            cursor: filters.activePresetId ? 'pointer' : 'not-allowed'
          }}
        >
          <BookmarkCheck size={16} /> Update Preset
        </button>

        {/* Exclusions Badge */}
        <button 
          onClick={() => setShowExclusions(true)}
          style={{ 
            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', 
            borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fef2f2', color: '#991b1b', cursor: 'pointer'
          }}
        >
          Excluded ({filters.excludedCustomers?.length || 0})
        </button>

        <div style={{ flex: 1 }} />

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onUploadClick} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Upload size={16} /> Upload
          </button>
          <button onClick={onClearClick} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444' }}>
            <Trash2 size={16} /> Clear
          </button>
          <button onClick={() => exportToExcelCsv(activeItems, 'DN_Export')} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={16} /> Excel / CSV
          </button>
          <button onClick={onPrintPdfClick} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Printer size={16} /> Print / PDF
          </button>
        </div>
      </div>

      {/* TIER 2 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', gap: '16px', backgroundColor: '#f8fafc', flexWrap: 'wrap' }}>
        
        {/* Balance Segmented Control */}
        <div style={{ display: 'flex', backgroundColor: '#e2e8f0', borderRadius: '6px', padding: '2px' }}>
          {(['ALL', 'PENDING', 'SETTLED'] as const).map(opt => (
            <button 
              key={opt}
              onClick={() => updateFilter('balanceFilter', opt)}
              style={{
                padding: '4px 12px', borderRadius: '4px', border: 'none', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                backgroundColor: filters.balanceFilter === opt ? 
                  (opt === 'PENDING' ? '#fbbf24' : opt === 'SETTLED' ? '#34d399' : 'white') 
                  : 'transparent',
                color: filters.balanceFilter === opt ? (opt === 'ALL' ? '#0f172a' : '#fff') : '#64748b'
              }}
            >
              {opt === 'ALL' ? 'All Records' : opt === 'PENDING' ? 'Balance ≥ 1' : 'Balance == 0'}
            </button>
          ))}
        </div>

        {/* Unit Selector */}
        <select 
          value={filters.unitFilter} 
          onChange={(e) => updateFilter('unitFilter', e.target.value)}
          style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
        >
          <option value="">All Units</option>
          {uniqueUnits.map(u => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>

        {/* Sort Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <select 
            value={filters.sortField} 
            onChange={(e) => updateFilter('sortField', e.target.value as any)}
            style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
          >
            <option value="">No Sort</option>
            <option value="customer">Customer Name</option>
            <option value="docNo">Document No</option>
            <option value="date">Date</option>
            <option value="balance">Balance (Col K)</option>
          </select>
          <button 
            onClick={toggleSortOrder} 
            style={{ padding: '4px', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}
          >
            {filters.sortOrder === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
          </button>
        </div>
      </div>

      {/* Exclusion Strip */}
      {filters.excludedCustomers?.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', gap: '8px', backgroundColor: '#fff1f2', flexWrap: 'wrap', borderTop: '1px solid #ffe4e6' }}>
          <span style={{ fontSize: '12px', color: '#9f1239', fontWeight: 'bold' }}>Excluded:</span>
          {filters.excludedCustomers.map(c => (
            <span key={c} style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', border: '1px solid #fda4af', color: '#881337' }}>
              {c}
              <X size={12} style={{ cursor: 'pointer' }} onClick={() => handleRemoveExclusion(c)} />
            </span>
          ))}
          <button onClick={handleClearExclusions} style={{ background: 'none', border: 'none', color: '#e11d48', fontSize: '12px', textDecoration: 'underline', cursor: 'pointer' }}>
            Clear All
          </button>
        </div>
      )}

      {showExclusions && <ExclusionsModal onClose={() => setShowExclusions(false)} />}
    </div>
  );
}
