import { createContext, useContext, useEffect, useState } from 'react';

const Ctx = createContext({ editMode: false, setEditMode: () => {} });

export function EditModeProvider({ children }) {
  const [editMode, setEditMode] = useState(() => {
    return localStorage.getItem('admin_edit_mode') === '1';
  });

  useEffect(() => {
    localStorage.setItem('admin_edit_mode', editMode ? '1' : '0');
  }, [editMode]);

  return <Ctx.Provider value={{ editMode, setEditMode }}>{children}</Ctx.Provider>;
}

export function useEditMode() {
  return useContext(Ctx);
}
