'use client';
import React, { useState } from 'react';
import { Plus, Trash2, Edit3, Save, Layers } from 'lucide-react';
import { useTracker } from './TrackerContext';
import ExclusionsModal from './ExclusionsModal';
import { Preset } from './types';

export default function PresetManagerView() {
  const { presets, setPresets } = useTracker();
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState('');

  const createPreset = () => {
    if (!newPresetName.trim()) return;
    const newPreset: Preset = {
      id: `preset-${Date.now()}`,
      name: newPresetName.trim(),
      excludedCompanies: []
    };
    setPresets([...presets, newPreset]);
    setNewPresetName('');
  };

  const deletePreset = (id: string) => {
    setPresets(presets.filter(p => p.id !== id));
  };

  const isBuiltIn = (id: string) => ['default', 'strict_pending', 'heavy_industrial'].includes(id);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
      <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Layers size={20} className="text-indigo-600" /> Reusable Filter Presets & Profiles Manager
          </h2>
          <p className="text-sm text-slate-500 mt-1">Manage global profiles to quickly include or exclude companies across all views.</p>
        </div>
      </div>
      
      <div className="p-6 flex-1 overflow-y-auto">
        <div className="mb-8">
          <label className="block text-sm font-medium text-slate-700 mb-2">Create New Custom Profile</label>
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="e.g. Retail Division Only" 
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createPreset()}
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            />
            <button 
              onClick={createPreset}
              disabled={!newPresetName.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} /> Create Profile
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-4">Saved Profiles</h3>
          {presets.map(preset => (
            <div key={preset.id} className="border border-slate-200 rounded-xl p-4 hover:border-indigo-300 transition-colors bg-white">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    {preset.name}
                    {isBuiltIn(preset.id) && (
                      <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full font-medium">Built-in</span>
                    )}
                  </h4>
                  {preset.balanceFilterOverride && (
                    <span className="inline-block mt-1 bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-medium">
                      Forces Balance Filter: {preset.balanceFilterOverride}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setEditingPresetId(preset.id)}
                    className="text-slate-500 hover:text-indigo-600 p-2 rounded-md hover:bg-indigo-50 transition-colors"
                    title="Edit Exclusions"
                  >
                    <Edit3 size={18} />
                  </button>
                  {!isBuiltIn(preset.id) && (
                    <button 
                      onClick={() => deletePreset(preset.id)}
                      className="text-slate-500 hover:text-rose-600 p-2 rounded-md hover:bg-rose-50 transition-colors"
                      title="Delete Profile"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <div className="font-medium text-slate-700 mb-1">Excluded Companies ({preset.excludedCompanies.length})</div>
                {preset.excludedCompanies.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {preset.excludedCompanies.map(c => (
                      <span key={c} className="bg-white border border-slate-200 text-slate-600 px-2 py-1 rounded-md text-xs shadow-sm">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-400 italic">No companies excluded.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {editingPresetId && (
        <ExclusionsModal presetId={editingPresetId} onClose={() => setEditingPresetId(null)} />
      )}
    </div>
  );
}
