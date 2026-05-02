import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import Navbar from "../components/Navbar";
import "./SettingsPage.css";

type SettingsSection =
  | "profile"
  | "appearance"
  | "stellar"
  | "security"
  | "danger"
  | "contact";

export default function SettingsPage() {
  const { orgName, orgEmail } = useAuth();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("profile");

  const sidebarItems = [
    { id: "profile", label: "Profile", icon: "profile" },
    { id: "appearance", label: "Appearance", icon: "palette" },
    { id: "stellar", label: "Stellar", icon: "stellar" },
    { id: "security", label: "Security", icon: "shield" },
    { id: "danger", label: "Danger Zone", icon: "alert" },
    { id: "contact", label: "Contact Support", icon: "contact" },
  ];

  const renderContent = () => {
    switch (activeSection) {
      case "profile":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Profile</h2>
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">
                  Organization Information
                </h3>
                <p className="settings-section-description">
                  Manage your organization's public profile
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Organization Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={orgName || ""}
                  readOnly
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  className="form-input"
                  value={orgEmail || ""}
                  readOnly
                />
              </div>
              <div className="form-actions">
                <button className="btn-primary">Update Profile</button>
              </div>
            </div>
          </div>
        );

      case "appearance":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Appearance</h2>
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Theme Settings</h3>
                <p className="settings-section-description">
                  Customize how AnonVote looks for you
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Theme Mode</label>
                <div className="theme-options">
                  <label className="theme-option">
                    <input type="radio" name="theme" defaultChecked />
                    <span className="theme-option-label">Light Mode</span>
                  </label>
                  <label className="theme-option">
                    <input type="radio" name="theme" />
                    <span className="theme-option-label">Dark Mode</span>
                  </label>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Font Size</label>
                <select className="form-select">
                  <option>Small (14px)</option>
                  <option selected>Medium (16px)</option>
                  <option>Large (18px)</option>
                  <option>Extra Large (20px)</option>
                </select>
              </div>
            </div>
          </div>
        );

      case "stellar":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Stellar Configuration</h2>
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Blockchain Settings</h3>
                <p className="settings-section-description">
                  Manage your Stellar network configuration
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Network</label>
                <input
                  type="text"
                  className="form-input"
                  value="Testnet"
                  readOnly
                />
              </div>
              <div className="form-group">
                <label className="form-label">Public Key</label>
                <div className="input-with-copy">
                  <input
                    type="text"
                    className="form-input"
                    value="GB..."
                    readOnly
                  />
                  <button className="btn-secondary">Copy</button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Account ID</label>
                <input
                  type="text"
                  className="form-input"
                  value="..."
                  readOnly
                />
              </div>
            </div>
          </div>
        );

      case "security":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Security</h2>
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">
                  Password & Authentication
                </h3>
                <p className="settings-section-description">
                  Keep your account secure
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Current Password</label>
                <input type="password" className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input type="password" className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm New Password</label>
                <input type="password" className="form-input" />
              </div>
              <div className="form-actions">
                <button className="btn-primary">Change Password</button>
              </div>
            </div>
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">
                  Two-Factor Authentication
                </h3>
                <p className="settings-section-description">
                  Add an extra layer of security to your account
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">2FA Status</label>
                <div className="status-badge status-active">Enabled</div>
              </div>
              <div className="form-actions">
                <button className="btn-secondary">Configure 2FA</button>
              </div>
            </div>
          </div>
        );

      case "danger":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Danger Zone</h2>
            <div className="card settings-card danger-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Delete Organization</h3>
                <p className="settings-section-description">
                  Permanently delete your organization and all associated data
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">
                  <span style={{ color: "var(--semantic-error)" }}>
                    Confirmation
                  </span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Type DELETE to confirm"
                />
              </div>
              <div className="form-actions">
                <button
                  className="btn-danger"
                  style={{ minHeight: "48px", padding: "8px 16px" }}
                >
                  Delete Organization
                </button>
              </div>
            </div>
          </div>
        );

      case "contact":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Contact Support</h2>
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Get in Touch</h3>
                <p className="settings-section-description">
                  We're here to help with any questions or issues
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <select className="form-select">
                  <option>General Inquiry</option>
                  <option>Technical Support</option>
                  <option>Billing Question</option>
                  <option>Feature Request</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <textarea className="form-textarea" rows={5} />
              </div>
              <div className="form-actions">
                <button className="btn-primary">Send Message</button>
              </div>
            </div>
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Help Resources</h3>
                <p className="settings-section-description">
                  Quick links to documentation and guides
                </p>
              </div>
              <div className="help-links">
                <a href="#" className="help-link">
                  <svg
                    className="help-link-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                  </svg>
                  <span className="help-link-text">Documentation</span>
                </a>
                <a href="#" className="help-link">
                  <svg
                    className="help-link-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="help-link-text">FAQ</span>
                </a>
                <a href="#" className="help-link">
                  <svg
                    className="help-link-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                    />
                  </svg>
                  <span className="help-link-text">Community Forum</span>
                </a>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="page-wrapper">
      <Navbar />
      <div
        style={{
          padding: "var(--space-8)",
          maxWidth: "800px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div className="settings-container">
          {/* Sidebar */}
          <nav className="settings-sidebar">
            <h2 className="settings-sidebar-title">Settings</h2>
            <ul className="settings-sidebar-list">
              {sidebarItems.map((item) => (
                <li key={item.id}>
                  <button
                    className={`settings-sidebar-item ${
                      activeSection === item.id ? "active" : ""
                    }`}
                    onClick={() => setActiveSection(item.id as SettingsSection)}
                  >
                    <span className="settings-sidebar-icon">
                      {getIcon(item.icon)}
                    </span>
                    <span className="settings-sidebar-label">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Content */}
          <main className="settings-content-area">{renderContent()}</main>
        </div>
      </div>
    </div>
  );
}

function getIcon(name: string) {
  const icons: Record<string, React.ReactNode> = {
    profile: (
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
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    ),
    palette: (
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
          d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
        />
      </svg>
    ),
    stellar: (
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
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    shield: (
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
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
    ),
    alert: (
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
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    ),
    contact: (
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
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
    ),
  };
  return icons[name] || null;
}
