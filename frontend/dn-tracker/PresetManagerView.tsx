'use client';
import React, { useState } from 'react';
import { useTracker } from './TrackerContext';
import { Preset } from './types';
import { Search, Plus, Trash2, Filter } from 'lucide-react';

export default function PresetManagerView() {
  const { presets, setPresets, activePresetId, setActivePresetId, items } = useTracker();
  const [newPresetName, setNewPresetName] = useState('');
  const [companySearch, setCompanySearch] = useState('');

  const uniqueCompanies = Array.from(new Set(items.map(i => i.customer))).filter(Boolean).sort();
  const filteredCompanies = uniqueCompanies.filter(c => c.toLowerCase().includes(companySearch.toLowerCase()));

  const addPreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;
    const preset: Preset = {
      id: `preset-${Date.now()}`,
      name: newPresetName.trim(),
      excludedCompanies: []
    };
    setPresets([...presets, preset]);
    setNewPresetName('');
  };

  const removePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2 mb-2">
          <Filter className="text-blue-600" />
          Filter Presets
        </h2>
        <p className="text-slate-500">Create presets to quickly hide or show specific companies across all views.</p>
      </div>

      <form onSubmit={addPreset} className="flex gap-2 mb-8 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <input 
          type="text" 
          value={newPresetName} 
          onChange={e => setNewPresetName(e.target.value)} 
          placeholder="Enter a new preset name..." 
          className="flex-1 px-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button 
          type="submit" 
          disabled={!newPresetName.trim()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-2 rounded-md font-medium transition-colors"
        >
          <Plus size={18} />
          Create Preset
        </button>
      </form>

      <div className="grid gap-4">
        {/* 'No Preset' Card */}
        <div 
          onClick={() => setActivePresetId(null)}
          className={`cursor-pointer p-5 rounded-xl border-2 transition-all ${
            activePresetId === null 
              ? 'border-blue-500 bg-blue-50 shadow-md' 
              : 'border-transparent bg-white shadow-sm hover:border-slate-300 hover:shadow-md'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${activePresetId === null ? 'border-blue-500' : 'border-slate-300'}`}>
              {activePresetId === null && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
            </div>
            <span className="font-semibold text-lg text-slate-800">Show All Companies</span>
            <span className="text-sm text-slate-500 ml-auto">Default</span>
          </div>
        </div>

        {/* Dynamic Presets */}
        {presets.map(preset => {
          const isActive = activePresetId === preset.id;
          return (
            <div 
              key={preset.id}
              className={`p-5 rounded-xl border-2 transition-all ${
                isActive 
                  ? 'border-blue-500 bg-blue-50/50 shadow-md' 
                  : 'border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <div 
                className="flex justify-between items-center cursor-pointer mb-2"
                onClick={() => setActivePresetId(preset.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isActive ? 'border-blue-500' : 'border-slate-300'}`}>
                    {isActive && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
                  </div>
                  <span className="font-semibold text-lg text-slate-800">{preset.name}</span>
                  <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-1 rounded-full ml-2">
                    {preset.excludedCompanies.length} hidden
                  </span>
                </div>
                <button 
                  onClick={(e) => removePreset(preset.id, e)}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  title="Delete Preset"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              {isActive && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <span className="font-medium text-slate-700">Select companies to hide from views:</span>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input 
                        type="text"
                        placeholder="Search companies..."
                        value={companySearch}
                        onChange={e => setCompanySearch(e.target.value)}
                        className="pl-9 pr-4 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64"
                      />
                    </div>
                  </div>

                  {filteredCompanies.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 bg-slate-50 rounded-lg border border-slate-100">
                      No companies match your search or no data uploaded yet.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-[300px] overflow-y-auto p-1">
                      {filteredCompanies.map(comp => {
                        const isExcluded = preset.excludedCompanies.includes(comp);
                        return (
                          <label 
                            key={comp} 
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-all select-none
                              ${isExcluded 
                                ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' 
                                : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'} border`}
                          >
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 text-red-600 rounded border-slate-300 focus:ring-red-500 cursor-pointer"
                              checked={isExcluded}
                              onChange={() => toggleExclusion(preset.id, comp)}
                            />
                            {comp}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
