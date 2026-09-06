import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../context/ThemeContext";
import { useAvatar } from "../hooks/useAvatar";
import { useState, useRef, useEffect } from "react";
import NotificationDropdown from "./NotificationDropdown";
import { getTotalTokensIssued } from "../api/client";
import { PersonIcon, SunIcon, MoonIcon, ExitIcon } from "@radix-ui/react-icons";
import "./Navbar.css";

export default function Navbar() {
  const { isAuthenticated, orgName, orgEmail, orgId, logout, loading } =
    useAuth();
  const { theme, toggleTheme } = useTheme();
  const { avatarUrl } = useAvatar(orgId);
  const navigate = useNavigate();

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [tokensIssued, setTokensIssued] = useState<number | null>(null);

  // Fetch total tokens issued when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetch = () => {
      getTotalTokensIssued()
        .then((res) => setTokensIssued(res.data.data.tokensIssued))
        .catch(() => {});
    };
    fetch();
    const interval = setInterval(fetch, 60_000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

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
              d="M 120 136 L 120 176 L 40 256 L 0 256 L 0 216 L 80 136 Z M 256 216 L 256 256 L 216 256 L 136 176 L 136 136 L 176 136 Z M 120 80 L 120 120 L 80 120 L 0 40 L 0 0 L 40 0 Z M 256 40 L 176 120 L 136 120 L 136 80 L 216 0 L 256 0 Z"
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
        <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M 120 136 L 120 176 L 40 256 L 0 256 L 0 216 L 80 136 Z M 256 216 L 256 256 L 216 256 L 136 176 L 136 136 L 176 136 Z M 120 80 L 120 120 L 80 120 L 0 40 L 0 0 L 40 0 Z M 256 40 L 176 120 L 136 120 L 136 80 L 216 0 L 256 0 Z"
            fill="currentColor"
          />
        </svg>
        <span>AnonVote</span>
      </Link>

      <div className="flex items-center gap-4">
        <span className="navbar-network">STELLAR TESTNET</span>

        {isAuthenticated && tokensIssued !== null && (
          <span
            title="Total tokens issued across all ballots"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-medium)",
              letterSpacing: "var(--tracking-wide)",
              padding: "3px var(--space-3)",
              borderRadius: "var(--radius-pill)",
              background: "var(--brand-primary-pale)",
              color: "var(--brand-primary)",
              border: "1px solid var(--brand-primary-ring)",
              whiteSpace: "nowrap",
            }}
          >
            TK {tokensIssued.toLocaleString()}
          </span>
        )}

        {isAuthenticated ? (
          <div className="flex items-center gap-2">
            {/* Notification Bell */}
            <NotificationDropdown />

            {/* User Avatar / Profile Button */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="navbar-avatar"
                aria-label="Open profile menu"
                aria-expanded={isProfileOpen}
                aria-haspopup="menu"
                style={avatarUrl ? { padding: 0, overflow: "hidden" } : {}}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: "50%",
                    }}
                  />
                ) : orgName ? (
                  orgName.charAt(0).toUpperCase()
                ) : (
                  "U"
                )}
              </button>

              {/* Profile Dropdown */}
              {isProfileOpen && (
                <div
                  className="navbar-dropdown card"
                  role="menu"
                  aria-label="Profile menu"
                >
                  <div className="profile-header">
                    <span
                      className="avatar-text"
                      style={
                        avatarUrl ? { padding: 0, overflow: "hidden" } : {}
                      }
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt="Profile"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            borderRadius: "50%",
                          }}
                        />
                      ) : orgName ? (
                        orgName.charAt(0).toUpperCase()
                      ) : (
                        "U"
                      )}
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
                    role="menuitem"
                  >
                    <PersonIcon className="profile-icon" />
                    <span className="profile-option-text">
                      Profile & Settings
                    </span>
                  </button>
                  <div className="navbar-dropdown-divider" />
                  <button
                    onClick={toggleTheme}
                    className="navbar-dropdown-item"
                    role="menuitem"
                    aria-label={
                      theme === "light"
                        ? "Switch to dark mode"
                        : "Switch to light mode"
                    }
                  >
                    {theme === "light" ? (
                      <MoonIcon className="profile-icon" />
                    ) : (
                      <SunIcon className="profile-icon" />
                    )}
                    <span className="profile-option-text">
                      {theme === "light" ? "Switch to Dark" : "Switch to Light"}
                    </span>
                  </button>
                  <div className="navbar-dropdown-divider" />
                  <button
                    onClick={handleLogoutClick}
                    className="navbar-dropdown-item danger"
                    role="menuitem"
                    aria-label="Log out of AnonVote"
                  >
                    <ExitIcon className="profile-icon" />
                    <span className="profile-option-text">Logout</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="navBarLogin flex items-center gap-4">
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
