import { useState, useEffect } from "react";
import { getMe, logoutOrg } from "../api/client";
import { useTheme } from "../context/ThemeContext";
import { useNotifications } from "../context/NotificationContext";

interface AuthState {
  isAuthenticated: boolean;
  orgName: string | null;
  orgEmail: string | null;
  orgId: string | null;
  loading: boolean;
}

export function useAuth(): AuthState & { logout: () => Promise<void> } {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    orgName: null,
    orgEmail: null,
    orgId: null,
    loading: true,
  });

  const { setUserId: setThemeUserId } = useTheme();
  const { clearNotifications, setUserId: setNotificationUserId } =
    useNotifications();

  useEffect(() => {
    // Don't check auth on public pages
    const currentPath = window.location.pathname;
    if (
      currentPath === "/login" ||
      currentPath === "/register" ||
      currentPath === "/"
    ) {
      setState({
        isAuthenticated: false,
        orgName: null,
        orgEmail: null,
        orgId: null,
        loading: false,
      });
      setThemeUserId(null);
      setNotificationUserId(null);
      return;
    }

    getMe()
      .then((res) => {
        const orgId = res.data.data.id;
        setState({
          isAuthenticated: true,
          orgName: res.data.data.name,
          orgEmail: res.data.data.email,
          orgId: orgId,
          loading: false,
        });
        // Set user ID for theme and notifications context
        setThemeUserId(orgId);
        setNotificationUserId(orgId);
      })
      .catch(() => {
        setState({
          isAuthenticated: false,
          orgName: null,
          orgEmail: null,
          orgId: null,
          loading: false,
        });
        setThemeUserId(null);
        setNotificationUserId(null);
      });
  }, [setThemeUserId, setNotificationUserId]);

  const logout = async () => {
    try {
      await logoutOrg();
    } finally {
      // Clear session-specific UI state (notifications, avatar)
      clearNotifications();

      // Clear user's avatar from localStorage
      if (state.orgId) {
        localStorage.removeItem(`avatar_${state.orgId}`);
      }

      // Clear user ID to preserve theme preference in localStorage
      // but prevent loading/saving to user-scoped keys
      setThemeUserId(null);
      setNotificationUserId(null);

      setState({
        isAuthenticated: false,
        orgName: null,
        orgEmail: null,
        orgId: null,
        loading: false,
      });
      window.location.href = "/login";
    }
  };

  return { ...state, logout };
}
