'use client';
import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Search } from 'lucide-react';
import { useTracker } from './TrackerContext';

interface ExclusionsModalProps {
  presetId: string;
  onClose: () => void;
}

export default function ExclusionsModal({ presetId, onClose }: ExclusionsModalProps) {
  const { items, presets, setPresets } = useTracker();
  const [searchTerm, setSearchTerm] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const preset = presets.find(p => p.id === presetId);
  
  const allCompanies = useMemo(() => {
    const names = new Set<string>();
    items.forEach(item => {
      if (item.customer) names.add(item.customer);
    });
    return Array.from(names).sort();
  }, [items]);

  if (!preset || !mounted) return null;

  const filteredCompanies = allCompanies.filter(c => c.toLowerCase().includes(searchTerm.toLowerCase()));

  const toggleExclusion = (company: string) => {
    setPresets(prev => prev.map(p => {
      if (p.id !== presetId) return p;
      const isExcluded = p.excludedCompanies.includes(company);
      if (isExcluded) {
        return { ...p, excludedCompanies: p.excludedCompanies.filter(c => c !== company) };
      } else {
        return { ...p, excludedCompanies: [...p.excludedCompanies, company] };
      }
    }));
  };

  const modalContent = (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-200">
          <h2 className="text-xl font-semibold text-slate-800">Edit Exclusions: {preset.name}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-4 border-b border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Search companies to exclude..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredCompanies.map(company => {
            const isExcluded = preset.excludedCompanies.includes(company);
            return (
              <label key={company} className="flex items-center space-x-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                <input 
                  type="checkbox" 
                  checked={isExcluded}
                  onChange={() => toggleExclusion(company)}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-slate-700">{company}</span>
                {isExcluded && <span className="ml-auto text-xs font-semibold text-rose-500 bg-rose-50 px-2 py-1 rounded-full">Excluded</span>}
              </label>
            );
          })}
          {filteredCompanies.length === 0 && (
            <div className="text-center text-slate-500 py-8 text-sm">No companies found.</div>
          )}
        </div>
        
        <div className="p-4 border-t border-slate-200 flex justify-end">
          <button type="button" onClick={onClose} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm transition-colors text-sm">
            Done
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
