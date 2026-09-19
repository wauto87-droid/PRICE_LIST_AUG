'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { OrderItem, Preset } from './types';

interface TrackerContextType {
  items: OrderItem[];
  setItems: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  presets: Preset[];
  setPresets: React.Dispatch<React.SetStateAction<Preset[]>>;
  activePresetId: string | null;
  setActivePresetId: React.Dispatch<React.SetStateAction<string | null>>;
  activeTab: string;
  setActiveTab: React.Dispatch<React.SetStateAction<string>>;
}

const TrackerContext = createContext<TrackerContextType | undefined>(undefined);

export const TrackerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('kanban');

  useEffect(() => {
    const savedPresets = localStorage.getItem('amt-dn-presets');
    if (savedPresets) {
      try {
        setPresets(JSON.parse(savedPresets));
      } catch (e) {
        console.error('Failed to parse presets', e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('amt-dn-presets', JSON.stringify(presets));
  }, [presets]);

  return (
    <TrackerContext.Provider value={{ items, setItems, presets, setPresets, activePresetId, setActivePresetId, activeTab, setActiveTab }}>
      {children}
    </TrackerContext.Provider>
  );
};

export const useTracker = () => {
  const context = useContext(TrackerContext);
  if (!context) throw new Error('useTracker must be used within a TrackerProvider');
  return context;
};
