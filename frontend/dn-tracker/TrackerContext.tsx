'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { OrderItem, Preset, GlobalFilters } from './types';

interface TrackerContextType {
  items: OrderItem[];
  setItems: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  presets: Preset[];
  setPresets: React.Dispatch<React.SetStateAction<Preset[]>>;
  activePresetId: string | null;
  setActivePresetId: React.Dispatch<React.SetStateAction<string | null>>;
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
  excludedCustomers: [],
  activePresetId: null,
  customerFilter: null
};

export const TrackerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeTab, setActiveTab] = useState<string>('kanban');
  const [filters, setFilters] = useState<GlobalFilters>(defaultFilters);
  const [isLoaded, setIsLoaded] = useState(false);

  // Backward compatibility alias for parts of code that used it
  const activePresetId = filters.activePresetId;
  const setActivePresetId = (idOrUpdater: React.SetStateAction<string | null>) => {
    setFilters(prev => ({
      ...prev,
      activePresetId: typeof idOrUpdater === 'function' ? idOrUpdater(prev.activePresetId) : idOrUpdater
    }));
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
      const savedPresets = localStorage.getItem('amt-dn-presets');
      if (savedPresets) {
        try {
          const parsed = JSON.parse(savedPresets);
          setPresets(parsed);
        } catch (e) {
          console.error('Failed to parse amt-dn-presets', e);
        }
      } else {
        // Init default preset
        const defaultPreset: Preset = {
          id: 'preset-heavy-industrial',
          name: 'Exclude Heavy Industrial Clients',
          excludedCompanies: ['PETROLUBE OIL COMPANY', 'ALHAMRANI COMPANY FOR INDUSTRY']
        };
        setPresets([defaultPreset]);
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
      localStorage.setItem('amt-dn-presets', JSON.stringify(presets));
    }
  }, [presets, isLoaded]);

  return (
    <TrackerContext.Provider value={{ 
      items, setItems, 
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
