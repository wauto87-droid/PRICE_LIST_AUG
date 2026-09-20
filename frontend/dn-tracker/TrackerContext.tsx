'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { OrderItem, CompanyGroup, GlobalFilters } from './types';

interface TrackerContextType {
  items: OrderItem[];
  setItems: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  groups: CompanyGroup[];
  setGroups: React.Dispatch<React.SetStateAction<CompanyGroup[]>>;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  groupFilterMode: 'include' | 'exclude';
  setGroupFilterMode: (mode: 'include' | 'exclude') => void;
  activeTab: string;
  setActiveTab: React.Dispatch<React.SetStateAction<string>>;
  filters: GlobalFilters;
  setFilters: React.Dispatch<React.SetStateAction<GlobalFilters>>;
  updateFilter: <K extends keyof GlobalFilters>(key: K, value: GlobalFilters[K]) => void;
}

const TrackerContext = createContext<TrackerContextType | undefined>(undefined);

const defaultFilters: GlobalFilters = {
  balanceFilter: 'ALL',
  unitFilter: '',
  searchQuery: '',
  sortField: '',
  sortOrder: 'asc',
  activeGroupId: null,
  groupFilterMode: 'exclude',
  customerFilter: null
};

export const TrackerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [activeTab, setActiveTab] = useState<string>('kanban');
  const [filters, setFilters] = useState<GlobalFilters>(defaultFilters);
  const [isLoaded, setIsLoaded] = useState(false);

  const activeGroupId = filters.activeGroupId;
  const setActiveGroupId = (id: string | null) => {
    setFilters(prev => ({ ...prev, activeGroupId: id }));
  };

  const groupFilterMode = filters.groupFilterMode;
  const setGroupFilterMode = (mode: 'include' | 'exclude') => {
    setFilters(prev => ({ ...prev, groupFilterMode: mode }));
  };

  const updateFilter = <K extends keyof GlobalFilters>(key: K, value: GlobalFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    // Attempt to load items
    const savedItems = localStorage.getItem('amt-dn-tracker-items');
    if (savedItems) {
      try {
        setItems(JSON.parse(savedItems));
      } catch (e) {
        console.error('Failed to parse amt-dn-tracker-items', e);
      }
    }

    // Attempt to load unified filters v2
    const savedFilters = localStorage.getItem('kanban_persistent_active_filters_v2');
    if (savedFilters) {
      try {
        setFilters({ ...defaultFilters, ...JSON.parse(savedFilters) });
      } catch (e) {
        console.error('Failed to parse kanban_persistent_active_filters_v2', e);
      }
    } else {
      // Migration from old presets to unified logic
      const savedGroups = localStorage.getItem('amt-dn-groups');
      if (savedGroups) {
        try {
          const parsed = JSON.parse(savedGroups);
          setGroups(parsed);
        } catch (e) {
          console.error('Failed to parse amt-dn-groups', e);
        }
      }
    }
    
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem('amt-dn-tracker-items', JSON.stringify(items));
      } catch (e) {
        console.error('Failed to save items to localStorage', e);
      }
    }
  }, [items, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('kanban_persistent_active_filters_v2', JSON.stringify(filters));
    }
  }, [filters, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('amt-dn-groups', JSON.stringify(groups));
    }
  }, [groups, isLoaded]);

  return (
    <TrackerContext.Provider value={{ 
      items, setItems, 
      groups, setGroups, 
      activeGroupId, setActiveGroupId, 
      groupFilterMode, setGroupFilterMode,
      activeTab, setActiveTab,
      filters, setFilters, updateFilter
    }}>
      {children}
    </TrackerContext.Provider>
  );
};

export const useTracker = () => {
  const context = useContext(TrackerContext);
  if (!context) throw new Error('useTracker must be used within a TrackerProvider');
  return context;
};
