import React, { useState, useMemo } from 'react';
import { X, Search, Plus } from 'lucide-react';
import { useTracker } from './TrackerContext';

interface ExclusionsModalProps {
  onClose: () => void;
}

export default function ExclusionsModal({ onClose }: ExclusionsModalProps) {
  const { items, filters, updateFilter, presets, setPresets } = useTracker();
  const [searchTerm, setSearchTerm] = useState('');

  const allCompanies = useMemo(() => {
    return Array.from(new Set(items.map(item => item.customer))).sort();
  }, [items]);

  const filteredCompanies = useMemo(() => {
    if (!searchTerm) return allCompanies;
    return allCompanies.filter(c => c.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [allCompanies, searchTerm]);

  const toggleInclusion = (company: string) => {
    const current = filters.includedCustomers || [];
    if (current.includes(company)) {
      updateFilter('includedCustomers', current.filter(c => c !== company));
    } else {
      updateFilter('includedCustomers', [...current, company]);
    }
  };

  const addToPreset = (company: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!filters.activePresetId) {
      alert('Please select a preset in the toolbar first to add companies to it permanently.');
      return;
    }
    setPresets(prev => prev.map(p => {
      if (p.id === filters.activePresetId) {
        const inc = p.includedCompanies || [];
        if (!inc.includes(company)) {
          return { ...p, includedCompanies: [...inc, company] };
        }
      }
      return p;
    }));
    // Also add to active inclusions if not already
    const current = filters.includedCustomers || [];
    if (!current.includes(company)) {
      updateFilter('includedCustomers', [...current, company]);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
      backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{
        backgroundColor: 'white', padding: '20px', borderRadius: '8px',
        width: '90%', maxWidth: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Manage Selections</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: '#64748b' }} />
          <input 
            type="text" 
            placeholder="Search companies to select..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ 
              width: '100%', padding: '8px 8px 8px 32px', 
              borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none'
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
          {filteredCompanies.map(company => {
            const isIncluded = filters.includedCustomers?.includes(company);
            const activePreset = filters.activePresetId ? presets.find(p => p.id === filters.activePresetId) : null;
            const isInActivePreset = activePreset && (activePreset.includedCompanies || []).includes(company);
            return (
              <div key={company} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px', borderBottom: '1px solid #f1f5f9',
                backgroundColor: isIncluded ? '#eff6ff' : 'white'
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1 }}>
                  <input 
                    type="checkbox" 
                    checked={isIncluded || false} 
                    onChange={() => toggleInclusion(company)}
                  />
                  <span style={{ fontSize: '14px', color: isIncluded ? '#2563eb' : '#334155' }}>{company}</span>
                </label>
                
                {filters.activePresetId && (
                  <button 
                    onClick={(e) => addToPreset(company, e)}
                    disabled={!!isInActivePreset}
                    title="Add to Preset"
                    style={{
                      background: isInActivePreset ? '#e2e8f0' : '#eff6ff',
                      color: isInActivePreset ? '#94a3b8' : '#2563eb',
                      border: 'none', padding: '4px 8px', borderRadius: '4px',
                      fontSize: '12px', cursor: isInActivePreset ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                  >
                    <Plus size={14} /> Add to Preset
                  </button>
                )}
              </div>
            );
          })}
          {filteredCompanies.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>No companies found.</div>
          )}
        </div>

        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-primary" style={{ padding: '8px 16px' }}>Done</button>
        </div>
      </div>
    </div>
  );
}
