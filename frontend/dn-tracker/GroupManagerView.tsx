'use client';
import React, { useState } from 'react';
import { useTracker } from './TrackerContext';
import { CompanyGroup } from './types';
import { Search, Plus, Trash2, Users } from 'lucide-react';
import CompanyGroupMenu from './CompanyGroupMenu';

export default function GroupManagerView() {
  const { groups, setGroups, items } = useTracker();
  const [newGroupName, setNewGroupName] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const uniqueCompanies = Array.from(new Set(items.map(i => i.customer))).filter(Boolean).sort();
  const filteredCompanies = uniqueCompanies.filter(c => c.toLowerCase().includes(companySearch.toLowerCase()));

  const addGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const group: CompanyGroup = {
      id: `group-${Date.now()}`,
      name: newGroupName.trim(),
      companies: []
    };
    setGroups([...groups, group]);
    setNewGroupName('');
    setEditingGroupId(group.id); // auto open the new group to add companies
  };

  const removeGroup = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setGroups(groups.filter(g => g.id !== id));
    if (editingGroupId === id) setEditingGroupId(null);
  };

  const toggleCompany = (groupId: string, company: string) => {
    setGroups(groups.map(g => {
      if (g.id !== groupId) return g;
      const comps = g.companies.includes(company)
        ? g.companies.filter(c => c !== company)
        : [...g.companies, company];
      return { ...g, companies: comps };
    }));
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2 mb-2">
          <Users className="text-blue-600" />
          Company Groups
        </h2>
        <p className="text-slate-500">Create groups of companies to easily filter your views later.</p>
      </div>

      <form onSubmit={addGroup} className="flex gap-2 mb-8 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <input 
          type="text" 
          value={newGroupName} 
          onChange={e => setNewGroupName(e.target.value)} 
          placeholder="Enter a new group name..." 
          className="flex-1 px-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button 
          type="submit" 
          disabled={!newGroupName.trim()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-2 rounded-md font-medium transition-colors"
        >
          <Plus size={18} />
          Create Group
        </button>
      </form>

      <div className="grid gap-4">
        {groups.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
            <Users size={32} className="mx-auto text-slate-300 mb-3" />
            <h3 className="text-lg font-medium text-slate-700">No Groups Yet</h3>
            <p className="text-slate-500">Create a group above to get started.</p>
          </div>
        )}

        {groups.map(group => {
          const isEditing = editingGroupId === group.id;
          return (
            <div 
              key={group.id}
              className={`p-5 rounded-xl border-2 transition-all ${
                isEditing 
                  ? 'border-blue-500 bg-blue-50/50 shadow-md' 
                  : 'border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <div 
                className="flex justify-between items-center cursor-pointer mb-2"
                onClick={() => setEditingGroupId(isEditing ? null : group.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isEditing ? 'border-blue-500' : 'border-slate-300'}`}>
                    {isEditing && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
                  </div>
                  <span className="font-semibold text-lg text-slate-800">{group.name}</span>
                  <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-1 rounded-full ml-2">
                    {group.companies?.length || 0} companies
                  </span>
                </div>
                <button 
                  onClick={(e) => removeGroup(group.id, e)}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  title="Delete Group"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              {isEditing && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <span className="font-medium text-slate-700">Select companies for this group:</span>
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
                        const inGroup = group.companies?.includes(comp) || false;
                        return (
                          <label 
                            key={comp} 
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-all select-none
                              ${inGroup 
                                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' 
                                : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'} border`}
                          >
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                              checked={inGroup}
                              onChange={() => toggleCompany(group.id, comp)}
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
