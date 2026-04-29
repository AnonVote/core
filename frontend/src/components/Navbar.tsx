import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../context/ThemeContext";
import "./Navbar.css";

export default function Navbar() {
  const { isAuthenticated, orgName, logout, loading } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Show skeleton while auth state is loading
  if (loading) {
    return (
      <nav className="navbar">
        <div className="navbar-logo">
          <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M 64 128 C 64 163.346 92.654 192 128 192 L 128 256 C 57.308 256 0 198.692 0 128 Z M 192 128 C 192 163.346 220.654 192 256 192 L 256 256 C 185.308 256 128 198.692 128 128 Z M 64 0 C 64 35.346 92.654 64 128 64 L 128 128 C 57.308 128 0 70.692 0 0 Z M 192 0 C 192 35.346 220.654 64 256 64 L 256 128 C 185.308 128 128 70.692 128 0 Z"
              fill="currentColor"
            />
          </svg>
          <span className="opacity-50">AnonVote</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="navbar-network font-mono">STELLAR TESTNET</span>
          <button className="theme-toggle" disabled>
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          </button>
        </div>
      </nav>
    );
  }

  return (
    <nav className="navbar">
      <Link
        to={isAuthenticated ? "/dashboard" : "/login"}
        className="navbar-logo"
      >
        <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M 64 128 C 64 163.346 92.654 192 128 192 L 128 256 C 57.308 256 0 198.692 0 128 Z M 192 128 C 192 163.346 220.654 192 256 192 L 256 256 C 185.308 256 128 198.692 128 128 Z M 64 0 C 64 35.346 92.654 64 128 64 L 128 128 C 57.308 128 0 70.692 0 0 Z M 192 0 C 192 35.346 220.654 64 256 64 L 256 128 C 185.308 128 128 70.692 128 0 Z"
            fill="currentColor"
          />
        </svg>
        <span>AnonVote</span>
      </Link>

      <div className="flex items-center gap-4">
        <span className="navbar-network">STELLAR TESTNET</span>

        <button
          onClick={toggleTheme}
          className="theme-toggle"
          aria-label="Toggle theme"
        >
          {theme === "light" ? (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          )}
        </button>

        {isAuthenticated ? (
          <div className="flex items-center gap-4">
            <div className="orgName">
              <span className="font-dm-sans text-sm font-medium">
                {orgName}
              </span>
            </div>

            <button
              onClick={logout}
              className="btn-primary"
              style={{ padding: "8px 16px" }}
            >
              Logout
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="navBarLogin">
              <Link to="/login" className="font-dm-sans text-sm font-medium">
                Login
              </Link>
            </div>

            <Link
              to="/register"
              className="btn-primary"
              style={{ padding: "8px 16px" }}
            >
              Register
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}
