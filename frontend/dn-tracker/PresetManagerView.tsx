'use client';
import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Edit3, Save, Layers, ArrowLeft, Search, CheckSquare, Square } from 'lucide-react';
import { useTracker } from './TrackerContext';
import { Preset } from './types';

export default function PresetManagerView() {
  const { presets, setPresets, items } = useTracker();
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const createPreset = () => {
    if (!newPresetName.trim()) return;
    const newId = `preset-${Date.now()}`;
    const newPreset: Preset = {
      id: newId,
      name: newPresetName.trim(),
      excludedCompanies: [],
      type: 'exclude'
    };
    setPresets([...presets, newPreset]);
    setNewPresetName('');
    setEditingPresetId(newId);
    setSearchTerm('');
  };

  const deletePreset = (id: string) => {
    setPresets(presets.filter(p => p.id !== id));
  };

  const isBuiltIn = (id: string) => ['default', 'strict_pending', 'heavy_industrial'].includes(id);

  const editingPreset = presets.find(p => p.id === editingPresetId);

  const allCompanies = useMemo(() => {
    const names = new Set<string>();
    items.forEach(item => {
      if (item.customer) names.add(item.customer);
    });
    // Ensure companies that are selected in profiles also show up, 
    // even if they don't exist in the currently uploaded file.
    presets.forEach(p => {
      p.excludedCompanies.forEach(c => names.add(c));
    });
    return Array.from(names).sort();
  }, [items, presets]);

  const toggleExclusion = (company: string) => {
    if (!editingPresetId) return;
    setPresets(prev => prev.map(p => {
      if (p.id !== editingPresetId) return p;
      const isExcluded = p.excludedCompanies.includes(company);
      if (isExcluded) {
        return { ...p, excludedCompanies: p.excludedCompanies.filter(c => c !== company) };
      } else {
        return { ...p, excludedCompanies: [...p.excludedCompanies, company] };
      }
    }));
  };

  if (editingPreset) {
    const isIncludeMode = editingPreset.type === 'include';
    const selectedSet = new Set(editingPreset.excludedCompanies);
    
    // Pure alphabetical sort to prevent rows from instantly jumping around while editing.
    // This also prevents users from thinking companies are missing from the A-Z list.
    const sortedCompanies = [...allCompanies]; // allCompanies is already sorted alphabetically in useMemo

    const filteredCompanies = sortedCompanies.filter(c => c.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button 
              type="button" 
              onClick={() => { setEditingPresetId(null); setSearchTerm(''); }}
              className="text-slate-500 hover:text-indigo-600 transition-colors bg-white border border-slate-200 p-2 rounded-lg shadow-sm"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                Edit Companies: {editingPreset.name}
              </h2>
              <p className="text-sm text-slate-500 mt-1">Select companies below to configure this profile.</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={() => { setEditingPresetId(null); setSearchTerm(''); }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
          >
            <Save size={16} /> Save & Return
          </button>
        </div>
        
        <div className="p-4 border-b border-slate-200 bg-white">
          <div className="flex gap-4">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Search companies..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm shadow-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700">Profile Mode:</label>
              <select
                value={editingPreset.type || 'exclude'}
                onChange={(e) => {
                  const newType = e.target.value as 'include' | 'exclude';
                  setPresets(prev => prev.map(p => p.id === editingPresetId ? { ...p, type: newType } : p));
                }}
                className="border border-slate-300 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm font-medium text-slate-800"
              >
                <option value="exclude">Exclude Selected Companies</option>
                <option value="include">Include ONLY Selected Companies</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="py-3 px-6 font-semibold text-sm text-slate-600 border-b border-slate-200 w-24 text-center">Select</th>
                <th className="py-3 px-6 font-semibold text-sm text-slate-600 border-b border-slate-200">Company Name</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.length > 0 ? (
                filteredCompanies.map(company => {
                  const isSelected = selectedSet.has(company);
                  
                  const rowClass = isSelected 
                    ? (isIncludeMode ? "border-b border-indigo-200 cursor-pointer transition-colors" : "border-b border-red-200 cursor-pointer transition-colors")
                    : "border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors";
                  
                  const checkboxClass = isSelected 
                    ? (isIncludeMode ? "text-indigo-600" : "text-rose-500")
                    : "text-slate-300";

                  const selectedBgColor = isIncludeMode ? "#e0e7ff" : "#fee2e2"; // indigo-100 or red-100

                  return (
                    <tr 
                      key={company} 
                      onClick={() => toggleExclusion(company)}
                      className={rowClass}
                      style={isSelected ? { backgroundColor: selectedBgColor } : {}}
                    >
                      <td className="py-3 px-6 text-center">
                        <div className="flex justify-center">
                          {isSelected ? (
                            <CheckSquare size={20} className={checkboxClass} />
                          ) : (
                            <Square size={20} className={checkboxClass} />
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-6 text-sm font-medium text-slate-700">
                        {company}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={2} className="py-12 text-center text-slate-500 text-sm">
                    No companies found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // LIST MODE
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
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm shadow-sm"
            />
            <button 
              type="button"
              onClick={createPreset}
              disabled={!newPresetName.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <Plus size={16} /> Create Profile
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-4">Saved Profiles</h3>
          {presets.map(preset => {
            const isIncludeMode = preset.type === 'include';
            const companiesText = isIncludeMode ? 'Included Companies' : 'Excluded Companies';
            const modeBadgeClass = isIncludeMode 
              ? "bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-medium ml-2"
              : "bg-rose-50 border border-rose-200 text-rose-700 text-xs px-2 py-0.5 rounded-full font-medium ml-2";
            const modeBadgeText = isIncludeMode ? "Include Mode" : "Exclude Mode";

            return (
              <div key={preset.id} className="border border-slate-200 rounded-xl p-4 hover:border-indigo-300 transition-colors bg-white shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="text-base font-bold text-slate-800 flex items-center">
                      {preset.name}
                      {isBuiltIn(preset.id) && (
                        <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full font-medium border border-slate-200 ml-2">Built-in</span>
                      )}
                      <span className={modeBadgeClass}>{modeBadgeText}</span>
                    </h4>
                    {preset.balanceFilterOverride && (
                      <span className="inline-block mt-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-2 py-0.5 rounded-full font-medium">
                        Forces Balance Filter: {preset.balanceFilterOverride}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button 
                      type="button"
                      onClick={() => { setEditingPresetId(preset.id); setSearchTerm(''); }}
                      className="text-slate-500 hover:text-indigo-600 p-2 rounded-lg hover:bg-indigo-50 transition-colors border border-transparent hover:border-indigo-100"
                      title="Configure Profile"
                    >
                      <Edit3 size={18} />
                    </button>
                    {!isBuiltIn(preset.id) && (
                      <button 
                        type="button"
                        onClick={() => deletePreset(preset.id)}
                        className="text-slate-500 hover:text-rose-600 p-2 rounded-lg hover:bg-rose-50 transition-colors border border-transparent hover:border-rose-100"
                        title="Delete Profile"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-sm border border-slate-100">
                  <div className="font-medium text-slate-700">{companiesText}</div>
                  <div className="text-slate-500 mt-1">
                    {preset.excludedCompanies.length > 0 
                      ? `${preset.excludedCompanies.length} companies selected. Click Edit to view or modify.`
                      : 'No companies selected.'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
