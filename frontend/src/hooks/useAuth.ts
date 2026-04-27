import { useState, useEffect } from "react";
import { getMe, logoutOrg } from "../api/client";

interface AuthState {
  isAuthenticated: boolean;
  orgName: string | null;
  orgId: string | null;
  loading: boolean;
}

export function useAuth(): AuthState & { logout: () => Promise<void> } {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    orgName: null,
    orgId: null,
    loading: true,
  });

  useEffect(() => {
    getMe()
      .then((res) => {
        setState({
          isAuthenticated: true,
          orgName: res.data.data.name,
          orgId: res.data.data.id,
          loading: false,
        });
      })
      .catch(() => {
        setState({
          isAuthenticated: false,
          orgName: null,
          orgId: null,
          loading: false,
        });
      });
  }, []);

  const logout = async () => {
    try {
      await logoutOrg();
    } finally {
      setState({
        isAuthenticated: false,
        orgName: null,
        orgId: null,
        loading: false,
      });
      window.location.href = "/login";
    }
  };

  return { ...state, logout };
}
