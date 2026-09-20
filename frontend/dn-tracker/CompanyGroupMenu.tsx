import React, { useState, useRef, useEffect } from 'react';
import { useTracker } from './TrackerContext';
import { Users, Plus, Check } from 'lucide-react';
import { CompanyGroup } from './types';

interface CompanyGroupMenuProps {
  company: string;
}

export default function CompanyGroupMenu({ company }: CompanyGroupMenuProps) {
  const { groups, setGroups } = useTracker();
  const [isOpen, setIsOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
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

  const toggleCompany = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setGroups(groups.map(g => {
      if (g.id !== groupId) return g;
      const comps = g.companies.includes(company)
        ? g.companies.filter(c => c !== company)
        : [...g.companies, company];
      return { ...g, companies: comps };
    }));
  };

  const createGroup = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!newGroupName.trim()) return;
    const group: CompanyGroup = {
      id: `group-${Date.now()}`,
      name: newGroupName.trim(),
      companies: [company]
    };
    setGroups([...groups, group]);
    setNewGroupName('');
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button 
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
        title="Add to group"
      >
        <Users size={14} />
      </button>

      {isOpen && (
        <div 
          className="absolute right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-50 py-2 text-sm text-slate-700"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 pb-2 border-b border-slate-100 mb-2 font-medium">
            Manage "{company}" in groups:
          </div>
          
          <div className="max-h-48 overflow-y-auto">
            {groups.length === 0 ? (
              <div className="px-3 py-2 text-slate-500 italic">No groups exist yet.</div>
            ) : (
              groups.map(g => {
                const inGroup = g.companies.includes(company);
                return (
                  <div 
                    key={g.id} 
                    className="px-3 py-1.5 hover:bg-slate-50 cursor-pointer flex items-center justify-between group"
                    onClick={(e) => toggleCompany(g.id, e)}
                  >
                    <span className="truncate pr-2">{g.name}</span>
                    {inGroup ? (
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

          <div className="px-3 pt-2 mt-2 border-t border-slate-100">
            <form onSubmit={createGroup} className="flex gap-1">
              <input 
                type="text" 
                placeholder="New group name..." 
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                className="flex-1 min-w-0 text-xs px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:border-blue-500"
              />
              <button 
                type="submit" 
                disabled={!newGroupName.trim()}
                className="p-1.5 bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded disabled:opacity-50"
              >
                <Plus size={14} />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
