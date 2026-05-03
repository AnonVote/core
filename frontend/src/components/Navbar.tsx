import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../context/ThemeContext";
import { useState, useRef, useEffect } from "react";
import NotificationDropdown from "./NotificationDropdown";
import "./Navbar.css";

export default function Navbar() {
  const { isAuthenticated, orgName, orgEmail, logout, loading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // User avatar dropdown state
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setIsProfileOpen(false);
      }
    }

    if (isProfileOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isProfileOpen]);

  const handleProfileClick = () => {
    navigate("/settings");
  };

  const handleLogoutClick = () => {
    logout();
  };

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
        <svg viewBox="0 0 150 176" xmlns="http://www.w3.org/2000/svg">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M 64 128 C 64 163.346 92.654 192 128 192 L 128 256 C 57.308 256 0 198.692 0 128 Z M 192 128 C 192 163.346 220.654 192 256 192 L 256 256 C 185.308 256 128 198.692 128 128 Z M 64 0 C 64 35.346 92.654 64 128 64 L 128 128 C 57.308 128 0 70.692 0 0 Z M 192 0 C 192 35.346 220.654 64 256 64 L 256 128 C 185.308 128 128 70.692 128 0 Z"
            fill="currentColor"
          />
        </svg>
        <span>AnonVote</span>
      </Link>

      <div className="flex items-center gap-4">
        <span className="navbar-network">STELLAR TESTNET</span>

        {isAuthenticated ? (
          <div className="flex items-center gap-2">
            {/* Notification Bell */}
            <NotificationDropdown />

            {/* User Avatar / Profile Button */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="navbar-avatar"
                aria-label="Profile"
              >
                {orgName ? orgName.charAt(0).toUpperCase() : "U"}
              </button>

              {/* Profile Dropdown */}
              {isProfileOpen && (
                <div className="navbar-dropdown card">
                  <div className="profile-header">
                    <span className="avatar-text">
                      {orgName ? orgName.charAt(0).toUpperCase() : "U"}
                    </span>
                    <div className="profile-info">
                      <span className="profile-name">{orgName || "User"}</span>
                      <span className="profile-email">
                        {orgEmail || "org@example.com"}
                      </span>
                    </div>
                  </div>
                  <div className="navbar-dropdown-divider" />
                  <button
                    onClick={handleProfileClick}
                    className="navbar-dropdown-item"
                  >
                    <svg
                      className="profile-icon"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    <span className="profile-option-text">
                      Profile & Settings
                    </span>
                  </button>
                  <div className="navbar-dropdown-divider" />
                  <button
                    onClick={toggleTheme}
                    className="navbar-dropdown-item"
                  >
                    <svg
                      className="profile-icon"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      {theme === "light" ? (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                        />
                      ) : (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                        />
                      )}
                    </svg>
                    <span className="profile-option-text">
                      {theme === "light" ? "Switch to Dark" : "Switch to Light"}
                    </span>
                  </button>
                  <div className="navbar-dropdown-divider" />
                  <button
                    onClick={handleLogoutClick}
                    className="navbar-dropdown-item danger"
                  >
                    <svg
                      className="profile-icon"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                      />
                    </svg>
                    <span className="profile-option-text">Logout</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <Link to="/login" className="font-dm-sans text-sm font-medium">
              Login
            </Link>
            <Link
              to="/register"
              className="btn-primary"
              style={{ minHeight: "36px", padding: "8px 16px" }}
            >
              Register
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}
