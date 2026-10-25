import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loading } from '../components/ui.jsx';
import { api } from './api.js';

function createSessionContext(kind) {
  const Context = createContext(null);

  function Provider({ children }) {
    // undefined while loading, null when logged out.
    const [user, setUser] = useState(undefined);
    const refresh = useCallback(async () => {
      try {
        const res = await api.get(`/auth/${kind}/me`);
        setUser(res[kind]);
      } catch {
        setUser(null);
      }
    }, []);
    useEffect(() => {
      refresh();
    }, [refresh]);
    const logout = useCallback(async () => {
      await api.post(`/auth/${kind}/logout`).catch(() => {});
      setUser(null);
    }, []);
    const value = useMemo(() => ({ user, setUser, refresh, logout }), [user, refresh, logout]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  const useSession = () => useContext(Context);
  return { Provider, useSession };
}

const student = createSessionContext('student');
const admin = createSessionContext('admin');

export const StudentProvider = student.Provider;
export const AdminProvider = admin.Provider;
export const useStudent = student.useSession;
export const useAdmin = admin.useSession;

export function RequireStudent({ children }) {
  const { user } = useStudent();
  const location = useLocation();
  if (user === undefined) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

export function RequireAdmin({ children }) {
  const { user } = useAdmin();
  if (user === undefined) return <Loading />;
  if (!user) return <Navigate to="/admin/login" replace />;
  return children;
}
