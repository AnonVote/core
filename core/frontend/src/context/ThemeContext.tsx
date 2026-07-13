import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  userId: string | null;
  setUserId: (userId: string | null) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const DEFAULT_THEME: Theme = "dark";
const THEME_KEY_PREFIX = "theme_";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => {
    // Load theme from localStorage
    // Theme is stored per user ID, e.g., theme_<userId>
    const savedTheme = localStorage.getItem("anonvote-theme") as Theme;
    if (savedTheme) return savedTheme;
    return DEFAULT_THEME;
  });

  // When userId changes, load the user's theme preference
  useEffect(() => {
    if (userId) {
      const userThemeKey = `${THEME_KEY_PREFIX}${userId}`;
      const userTheme = localStorage.getItem(userThemeKey) as Theme | null;
      if (userTheme) {
        setThemeState(userTheme);
      } else {
        // New user defaults to dark
        setThemeState(DEFAULT_THEME);
      }
    }
  }, [userId]);

  useEffect(() => {
    // Update data-theme attribute on document
    document.documentElement.setAttribute("data-theme", theme);

    // Save to localStorage
    // If user is logged in, save to user-scoped key, otherwise use global key
    if (userId) {
      const userThemeKey = `${THEME_KEY_PREFIX}${userId}`;
      localStorage.setItem(userThemeKey, theme);
    } else {
      localStorage.setItem("anonvote-theme", theme);
    }
  }, [theme, userId]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === "light" ? "dark" : "light"));
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider
      value={{ theme, toggleTheme, setTheme, userId, setUserId }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
