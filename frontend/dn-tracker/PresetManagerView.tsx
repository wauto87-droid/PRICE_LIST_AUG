'use client';
import React, { useState } from 'react';
import { useTracker } from './TrackerContext';
import { Preset } from './types';

export default function PresetManagerView() {
  const { presets, setPresets, activePresetId, setActivePresetId } = useTracker();
  const [newPresetName, setNewPresetName] = useState('');

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

      <ul className="preset-list">
        {presets.map(preset => (
          <li key={preset.id}>
            <label>
              <input 
                type="radio" 
                checked={activePresetId === preset.id} 
                onChange={() => setActivePresetId(preset.id)} 
              />
              {preset.name}
            </label>
            <button className="btn btn-danger" onClick={() => removePreset(preset.id)}>Remove</button>
          </li>
        ))}
      </ul>
      <p style={{marginTop: 20, color: '#666', fontSize: 13}}>Note: Excluding specific companies via preset is a feature foundation. The full exclusion matrix is WIP.</p>
    </div>
  );
}
