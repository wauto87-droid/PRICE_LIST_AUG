'use client';
import React, { useState } from 'react';
import { useTracker } from './TrackerContext';
import { Preset } from './types';

export default function PresetManagerView() {
  const { presets, setPresets, activePresetId, setActivePresetId, items } = useTracker();
  const [newPresetName, setNewPresetName] = useState('');

  const uniqueCompanies = Array.from(new Set(items.map(i => i.customer))).filter(Boolean).sort();

  const addPreset = () => {
    if (!newPresetName.trim()) return;
    const preset: Preset = {
      id: `preset-${Date.now()}`,
      name: newPresetName.trim(),
      excludedCompanies: []
    };
    setPresets([...presets, preset]);
    setNewPresetName('');
  };

  const removePreset = (id: string) => {
    setPresets(presets.filter(p => p.id !== id));
    if (activePresetId === id) setActivePresetId(null);
  };

  const toggleExclusion = (presetId: string, company: string) => {
    setPresets(presets.map(p => {
      if (p.id !== presetId) return p;
      const excluded = p.excludedCompanies.includes(company)
        ? p.excludedCompanies.filter(c => c !== company)
        : [...p.excludedCompanies, company];
      return { ...p, excludedCompanies: excluded };
    }));
  };

  return (
    <div className="preset-manager">
      <h3>Filter Presets</h3>
      <div className="preset-form">
        <input 
          type="text" 
          value={newPresetName} 
          onChange={e => setNewPresetName(e.target.value)} 
          placeholder="New preset name..." 
        />
        <button className="btn btn-primary" onClick={addPreset}>Add Preset</button>
      </div>

      <ul className="preset-list" style={{ listStyle: 'none', padding: 0 }}>
        <li key="none" style={{ marginBottom: '1rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '4px', background: activePresetId === null ? '#f0f9ff' : 'transparent' }}>
          <label style={{ fontWeight: 'bold', cursor: 'pointer' }}>
            <input 
              type="radio" 
              checked={activePresetId === null} 
              onChange={() => setActivePresetId(null)} 
              style={{ marginRight: '8px' }}
            />
            No Preset (Show All)
          </label>
        </li>
        {presets.map(preset => (
          <li key={preset.id} style={{ marginBottom: '1rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '4px', background: activePresetId === preset.id ? '#f0f9ff' : 'transparent' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontWeight: 'bold', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  checked={activePresetId === preset.id} 
                  onChange={() => setActivePresetId(preset.id)} 
                  style={{ marginRight: '8px' }}
                />
                {preset.name}
              </label>
              <button className="btn btn-danger" onClick={() => removePreset(preset.id)}>Remove</button>
            </div>
            <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
              <div style={{ marginBottom: '6px' }}><strong>Excluded Companies (Check to hide):</strong></div>
              {uniqueCompanies.length === 0 && <span style={{color:'#888'}}>No companies available. Upload data first.</span>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {uniqueCompanies.map(comp => (
                  <label key={comp} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: preset.excludedCompanies.includes(comp) ? '#ffebee' : '#f5f5f5', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', border: preset.excludedCompanies.includes(comp) ? '1px solid #ffcdd2' : '1px solid transparent' }}>
                    <input
                      type="checkbox"
                      checked={preset.excludedCompanies.includes(comp)}
                      onChange={() => toggleExclusion(preset.id, comp)}
                    />
                    {comp}
                  </label>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
