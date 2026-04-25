import React, { createContext, useContext, useState } from 'react';

const STORAGE_KEY = 'knife4j_global_params';

export interface GlobalParamItem {
  id: string;
  name: string;
  value: string;
  in: 'header' | 'query';
}

interface GlobalParamContextValue {
  params: GlobalParamItem[];
  addParam: (param: Omit<GlobalParamItem, 'id'>) => void;
  removeParam: (id: string) => void;
}

const GlobalParamContext = createContext<GlobalParamContextValue | null>(null);

function loadFromStorage(): GlobalParamItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const GlobalParamProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [params, setParams] = useState<GlobalParamItem[]>(loadFromStorage);

  const addParam = (param: Omit<GlobalParamItem, 'id'>) => {
    const next = [...params, { ...param, id: crypto.randomUUID() }];
    setParams(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const removeParam = (id: string) => {
    const next = params.filter((p) => p.id !== id);
    setParams(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return (
    <GlobalParamContext.Provider value={{ params, addParam, removeParam }}>{children}</GlobalParamContext.Provider>
  );
};

export const useGlobalParam = (): GlobalParamContextValue => {
  const ctx = useContext(GlobalParamContext);
  if (!ctx) throw new Error('useGlobalParam must be used inside GlobalParamProvider');
  return ctx;
};
