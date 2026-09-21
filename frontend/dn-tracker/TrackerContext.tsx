'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { OrderItem, Preset, GlobalFilters } from './types';

interface TrackerContextType {
  items: OrderItem[];
  setItems: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  knownCompanies: string[];
  setKnownCompanies: React.Dispatch<React.SetStateAction<string[]>>;
  clearData: () => void;
  presets: Preset[];
  setPresets: React.Dispatch<React.SetStateAction<Preset[]>>;
  activePresetId: string | null;
  setActivePresetId: (id: string | null) => void;
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
  activePresetId: 'default',
  customerFilter: null
};

const builtInPresets: Preset[] = [
  { id: 'default', name: 'Standard View (Default)', excludedCompanies: [] },
  { id: 'strict_pending', name: 'Balance ≥ 1 Only', excludedCompanies: [], balanceFilterOverride: 'PENDING' },
  { id: 'heavy_industrial', name: 'Exclude Heavy Industrial Clients', excludedCompanies: ['AL ENMAA FOOD COMPANY LIMITED', 'AL ASISAT'] }
];

export const TrackerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [knownCompanies, setKnownCompanies] = useState<string[]>([]);
  const [presets, setPresets] = useState<Preset[]>(builtInPresets);
  const [activeTab, setActiveTab] = useState<string>('kanban');
  const [filters, setFilters] = useState<GlobalFilters>(defaultFilters);
  const [isLoaded, setIsLoaded] = useState(false);

  const clearData = () => {
    setItems([]);
    try {
      localStorage.removeItem('amt-dn-tracker-items');
      localStorage.setItem('amt-dn-tracker-items', '[]');
    } catch (e) {
      console.error('Failed to clear items from storage', e);
    }
  };

  const activePresetId = filters.activePresetId;
  const setActivePresetId = (id: string | null) => {
    setFilters(prev => ({ ...prev, activePresetId: id }));
  };

  const updateFilter = <K extends keyof GlobalFilters>(key: K, value: GlobalFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    const savedItems = localStorage.getItem('amt-dn-tracker-items');
    if (savedItems) {
      try {
        setItems(JSON.parse(savedItems));
      } catch (e) {
        console.error('Failed to parse amt-dn-tracker-items', e);
      }
    }

    const savedFilters = localStorage.getItem('kanban_persistent_active_filters_v3');
    if (savedFilters) {
      try {
        setFilters({ ...defaultFilters, ...JSON.parse(savedFilters) });
      } catch (e) {
        console.error('Failed to parse kanban_persistent_active_filters_v3', e);
      }
    }

    const savedPresets = localStorage.getItem('kanban_persistent_saved_profiles_v2');
    if (savedPresets) {
      try {
        const parsed = JSON.parse(savedPresets);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPresets(parsed);
        }
      } catch (e) {
        console.error('Failed to parse kanban_persistent_saved_profiles_v2', e);
      }
    }

    const savedKnown = localStorage.getItem('amt-known-companies-v1');
    if (savedKnown) {
      try {
        const parsed = JSON.parse(savedKnown);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setKnownCompanies(parsed);
        }
      } catch (e) {}
    }
    
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem('amt-dn-tracker-items', JSON.stringify(items));
      } catch (e) {
        console.error('Failed to save items', e);
      }
    }
  }, [items, isLoaded]);

  useEffect(() => {
    if (isLoaded && items.length > 0) {
      setKnownCompanies(prev => {
        const set = new Set(prev);
        items.forEach(i => {
          if (i.customer && i.customer.trim()) set.add(i.customer.trim());
        });
        const updated = Array.from(set).sort();
        try {
          localStorage.setItem('amt-known-companies-v1', JSON.stringify(updated));
        } catch (e) {}
        return updated;
      });
    }
  }, [items, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('kanban_persistent_active_filters_v3', JSON.stringify(filters));
    }
  }, [filters, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('kanban_persistent_saved_profiles_v2', JSON.stringify(presets));
    }
  }, [presets, isLoaded]);

  return (
    <TrackerContext.Provider value={{ 
      items, setItems, 
      knownCompanies, setKnownCompanies,
      clearData,
      presets, setPresets, 
      activePresetId, setActivePresetId, 
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
