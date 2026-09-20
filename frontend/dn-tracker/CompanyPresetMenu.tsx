import React, { useState, useRef, useEffect } from 'react';
import { useTracker } from './TrackerContext';
import { ListPlus, Plus, Check } from 'lucide-react';
import { Preset } from './types';

interface CompanyPresetMenuProps {
  company: string;
}

export default function CompanyPresetMenu({ company }: CompanyPresetMenuProps) {
  const { presets, setPresets } = useTracker();
  const [isOpen, setIsOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleInclusion = (presetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPresets(presets.map(p => {
      if (p.id !== presetId) return p;
      const included = p.includedCompanies?.includes(company)
        ? p.includedCompanies.filter(c => c !== company)
        : [...(p.includedCompanies || []), company];
      return { ...p, includedCompanies: included };
    }));
  };

  const createPresetAndAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;
    const preset: Preset = {
      id: `preset-${Date.now()}`,
      name: newPresetName.trim(),
      includedCompanies: [company]
    };
    setPresets([...presets, preset]);
    setNewPresetName('');
  };

  return (
    <div className="relative inline-block" ref={menuRef} onClick={e => e.stopPropagation()}>
      <button 
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
        title="Add to group / preset"
      >
        <ListPlus size={14} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 shadow-xl rounded-md z-50 py-2 text-sm text-slate-800">
          <div className="px-3 pb-2 border-b border-slate-100 mb-2 font-medium">
            Include "{company}" in preset:
          </div>
          
          <div className="max-h-48 overflow-y-auto">
            {presets.length === 0 ? (
              <div className="px-3 py-2 text-slate-500 italic">No presets exist yet.</div>
            ) : (
              presets.map(p => {
                const isIncluded = p.includedCompanies?.includes(company);
                return (
                  <div 
                    key={p.id} 
                    className="px-3 py-1.5 hover:bg-slate-50 cursor-pointer flex items-center justify-between group"
                    onClick={(e) => toggleInclusion(p.id, e)}
                  >
                    <span className="truncate pr-2">{p.name}</span>
                    {isIncluded ? (
                      <span className="text-blue-600 text-xs font-medium">Included</span>
                    ) : (
                      <span className="text-slate-300 group-hover:text-slate-400">
                        <Check size={14} opacity={0} className="group-hover:opacity-100 transition-opacity" />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={createPresetAndAdd} className="px-3 pt-2 mt-2 border-t border-slate-100 flex gap-2">
            <input 
              type="text" 
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              placeholder="New preset name..."
              className="flex-1 min-w-0 px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:border-blue-500"
            />
            <button 
              type="submit" 
              disabled={!newPresetName.trim()}
              className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-slate-300"
            >
              <Plus size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
