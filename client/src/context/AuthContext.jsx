import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, getAgent, saveSession, clearSession } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const doLogout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function validate() {
      if (!getAgent()) {
        if (mounted) setLoading(false);
        return;
      }
      try {
        const { agent } = await api.me();
        if (mounted) {
          setUser(agent);
          saveSession(getSessionToken(), agent);
        }
      } catch {
        doLogout();
      } finally {
        if (mounted) setLoading(false);
      }
    }

    const cached = getAgent();
    if (cached) setUser(cached);

    validate();
    return () => {
      mounted = false;
    };
  }, [doLogout]);

  const login = useCallback(async (email, password) => {
    const { token, agent } = await api.login(email, password);
    saveSession(token, agent);
    setUser(agent);
    return agent;
  }, []);

  const logout = useCallback(() => {
    doLogout();
  }, [doLogout]);

  if (loading && !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-cloud">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

function getSessionToken() {
  try {
    return localStorage.getItem('omnichannel_token');
  } catch {
    return null;
  }
}

export function useAuth() {
  return useContext(AuthContext);
}