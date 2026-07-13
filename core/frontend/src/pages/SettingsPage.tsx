import { useState, useEffect, useRef } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import {
  updateOrg,
  changePassword,
  deleteAccount,
  getMe,
  getRateLimitSettings,
  updateRateLimitSettings,
} from "../api/client";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../context/ThemeContext";
import { useAvatar } from "../hooks/useAvatar";
import { useNotifications } from "../context/NotificationContext";
import {
  CheckIcon,
  InfoCircledIcon,
  ExclamationTriangleIcon,
  SunIcon,
  MoonIcon,
  ExternalLinkIcon,
  PersonIcon,
  LockClosedIcon,
  CheckCircledIcon,
  ChatBubbleIcon,
} from "@radix-ui/react-icons";
import "./SettingsPage.css";

type SettingsSection =
  | "profile"
  | "appearance"
  | "stellar"
  | "security"
  | "danger"
  | "contact";

interface OrganizationDetails {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export default function SettingsPage() {
  const { orgName, orgId, loading: authLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const { avatarUrl, uploadAvatar, removeAvatar } = useAvatar(orgId);
  const { addNotification } = useNotifications();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("profile");
  const [orgDetails, setOrgDetails] = useState<OrganizationDetails | null>(
    null,
  );
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedEmail, setEditedEmail] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [copySuccess, setCopySuccess] = useState(false);

  const [selectedColor, setSelectedColor] = useState<string>(() => {
    return localStorage.getItem("anonvote-accent") || "#059669";
  });
  const [selectedFontSize, setSelectedFontSize] = useState<string>(() => {
    return localStorage.getItem("anonvote-font-size") || "14px";
  });

  const [network, setNetwork] = useState<"testnet" | "mainnet">("testnet");
  const stellarExpertUrl =
    network === "mainnet"
      ? "https://stellar.expert/explorer/public"
      : "https://stellar.expert/explorer/testnet";
  const [orgStellarPublicKey] = useState<string | null>(null);
  const [lastTransactionId] = useState<string | null>(null);
  const [totalTransactions] = useState<number>(0);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");

  const [showDeleteBallotsConfirm, setShowDeleteBallotsConfirm] =
    useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] =
    useState(false);
  const [deleteBallotsConfirmText, setDeleteBallotsConfirmText] = useState("");
  const [deleteAccountConfirmText, setDeleteAccountConfirmText] = useState("");

  // Rate limit state
  const [rateLimitPreset, setRateLimitPreset] = useState<string>("standard");
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    maxAttempts: number;
    windowMinutes: number;
  } | null>(null);
  const [rateLimitSaving, setRateLimitSaving] = useState(false);
  const [rateLimitStatus, setRateLimitStatus] = useState<
    "idle" | "success" | "error"
  >("idle");

  // Fetch org details from API
  useEffect(() => {
    if (!authLoading) {
      getMe()
        .then((res) => {
          const data = res.data.data;
          setOrgDetails({
            id: data.id,
            name: data.name,
            email: data.email,
            createdAt: data.createdAt,
          });
          setEditedName(data.name);
          setEditedEmail(data.email);
        })
        .catch(() => {});

      getRateLimitSettings()
        .then((res) => {
          const { current } = res.data.data;
          setRateLimitPreset(current.preset);
          setRateLimitInfo({
            maxAttempts: current.maxAttempts,
            windowMinutes: current.windowMinutes,
          });
        })
        .catch(() => {});
    }
  }, [authLoading]);

  const handleSaveRateLimit = async (preset: string) => {
    setRateLimitSaving(true);
    try {
      const res = await updateRateLimitSettings(preset);
      setRateLimitPreset(res.data.data.preset);
      setRateLimitInfo({
        maxAttempts: res.data.data.maxAttempts,
        windowMinutes: res.data.data.windowMinutes,
      });
      setRateLimitStatus("success");
      setTimeout(() => setRateLimitStatus("idle"), 2500);
    } catch {
      setRateLimitStatus("error");
      setTimeout(() => setRateLimitStatus("idle"), 2500);
    } finally {
      setRateLimitSaving(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 8 || newPassword !== confirmPassword) return;
    setPasswordStatus("saving");
    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordStatus("success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordStatus("idle"), 3000);
    } catch {
      setPasswordStatus("error");
      setTimeout(() => setPasswordStatus("idle"), 3000);
    }
  };

  const getBrowserInfo = () => {
    const ua = navigator.userAgent;
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Safari")) return "Safari";
    if (ua.includes("Edge")) return "Edge";
    return "Unknown Browser";
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const handleDeleteAllBallots = async () => {
    setShowDeleteBallotsConfirm(false);
    setDeleteBallotsConfirmText("");
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
      localStorage.removeItem("anonvote-theme");
      localStorage.removeItem("anonvote-accent");
      localStorage.removeItem("anonvote-font-size");
      window.location.href = "/login";
    } catch {
      // handle error
    }
  };

  const sidebarItems = [
    { id: "profile", label: "Profile", icon: "profile" },
    { id: "appearance", label: "Appearance", icon: "palette" },
    { id: "stellar", label: "Stellar", icon: "stellar" },
    { id: "security", label: "Security", icon: "shield" },
    { id: "danger", label: "Danger Zone", icon: "alert" },
    { id: "contact", label: "Contact Support", icon: "contact" },
  ];

  const handleSaveName = async () => {
    if (!editedName.trim()) return;
    setSaveStatus("saving");
    try {
      await updateOrg({ name: editedName });
      setOrgDetails((prev) => (prev ? { ...prev, name: editedName } : null));
      setIsEditingName(false);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const handleSaveEmail = async () => {
    if (!editedEmail.trim()) return;
    setSaveStatus("saving");
    try {
      await updateOrg({ email: editedEmail });
      setOrgDetails((prev) => (prev ? { ...prev, email: editedEmail } : null));
      setIsEditingEmail(false);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingName(false);
    setIsEditingEmail(false);
    if (orgDetails) {
      setEditedName(orgDetails.name);
      setEditedEmail(orgDetails.email);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
  };

  const renderContent = () => {
    switch (activeSection) {
      case "profile":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Profile</h2>
            <p className="settings-page-subtitle">
              Manage your organization's public information.
            </p>

            {/* Profile Picture Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Profile Picture</h3>
                <p className="settings-section-description">
                  Add a photo to your organization profile
                </p>
              </div>
              <div className="profile-picture-section">
                {/* Avatar preview */}
                <div
                  className="profile-avatar"
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
                  ) : orgDetails?.name ? (
                    orgDetails.name.charAt(0).toUpperCase()
                  ) : (
                    "U"
                  )}
                </div>

                {/* Hidden file input */}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setAvatarError("");
                    try {
                      await uploadAvatar(file);
                      setToast({
                        message: "Profile picture updated successfully",
                        type: "success",
                      });
                      addNotification({
                        type: "ballot_created",
                        title: "Profile picture updated",
                        message: "Your new profile picture is now active",
                      });
                    } catch (err: any) {
                      setAvatarError(err.message || "Failed to upload image");
                      setToast({
                        message: err.message || "Failed to upload image",
                        type: "error",
                      });
                    }
                    e.target.value = "";
                  }}
                />

                <div className="profile-actions">
                  <button
                    className="btn-ghost"
                    style={{ minHeight: "36px", padding: "8px 16px" }}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    {avatarUrl ? "Change photo" : "Upload photo"}
                  </button>
                  {avatarUrl && !showRemoveConfirm && (
                    <span
                      className="profile-remove"
                      style={{
                        color: "var(--semantic-error)",
                        fontSize: "var(--text-sm)",
                        cursor: "pointer",
                        fontFamily: "var(--font-body)",
                      }}
                      onClick={() => setShowRemoveConfirm(true)}
                    >
                      Remove
                    </span>
                  )}
                </div>

                {/* Remove confirmation */}
                {showRemoveConfirm && (
                  <div
                    style={{
                      marginTop: "var(--space-3)",
                      padding: "var(--space-4)",
                      background: "var(--semantic-error-light)",
                      border: "1px solid var(--semantic-error-border)",
                      borderRadius: "var(--radius-md)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-3)",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "var(--text-sm)",
                        color: "var(--ink-primary)",
                        margin: 0,
                      }}
                    >
                      Remove your profile picture? Your initial letter will be
                      shown instead.
                    </p>
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <button
                        className="btn-ghost"
                        style={{
                          minHeight: "36px",
                          padding: "6px 14px",
                          fontSize: "var(--text-sm)",
                        }}
                        onClick={() => setShowRemoveConfirm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn-danger"
                        style={{
                          minHeight: "36px",
                          padding: "6px 14px",
                          fontSize: "var(--text-sm)",
                          borderRadius: "var(--radius-md)",
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "var(--font-display)",
                          fontWeight: "var(--weight-semibold)",
                          color: "white",
                        }}
                        onClick={() => {
                          removeAvatar();
                          setShowRemoveConfirm(false);
                          setToast({
                            message: "Profile picture removed",
                            type: "success",
                          });
                          addNotification({
                            type: "warning",
                            title: "Profile picture removed",
                            message: "Your profile picture has been removed",
                          });
                        }}
                      >
                        Yes, remove it
                      </button>
                    </div>
                  </div>
                )}

                {avatarError && (
                  <p
                    style={{
                      color: "var(--semantic-error)",
                      fontSize: "var(--text-xs)",
                      marginTop: "var(--space-2)",
                    }}
                  >
                    {avatarError}
                  </p>
                )}
                <p
                  className="profile-note"
                  style={{
                    color: "var(--ink-muted)",
                    fontSize: "var(--text-xs)",
                    marginTop: "var(--space-2)",
                  }}
                >
                  Supported formats: JPG, PNG, WebP. Max 2MB.
                </p>
              </div>
            </div>

            {/* Organization Details Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Organization Details</h3>
                <p className="settings-section-description">
                  Manage your organization's information
                </p>
              </div>

              {saveStatus === "success" && (
                <div
                  className="message message-success"
                  style={{ marginBottom: "var(--space-4)" }}
                >
                  <span className="message-icon">
                    <CheckIcon width="16" height="16" />
                  </span>
                  <span>Changes saved successfully</span>
                </div>
              )}

              {saveStatus === "error" && (
                <div
                  className="message message-error"
                  style={{ marginBottom: "var(--space-4)" }}
                >
                  <span className="message-icon">
                    <InfoCircledIcon width="16" height="16" />
                  </span>
                  <span>Failed to save changes. Please try again.</span>
                </div>
              )}

              {/* Organization Name */}
              <div className="form-group">
                <label className="form-label">Organization Name</label>
                <div className="form-row">
                  {isEditingName ? (
                    <div className="editing-row">
                      <input
                        type="text"
                        className="input-field"
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        placeholder="Enter organization name"
                      />
                      <div className="form-actions">
                        <button
                          className="btn-primary"
                          onClick={handleSaveName}
                          disabled={saveStatus === "saving"}
                          style={{ minHeight: "36px", padding: "8px 16px" }}
                        >
                          {saveStatus === "saving" ? "Saving..." : "Save"}
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={handleCancelEdit}
                          style={{ minHeight: "36px", padding: "8px 16px" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="view-row">
                      <span className="chip-mono">
                        {orgDetails?.name || "—"}
                      </span>
                      <button
                        className="btn-ghost"
                        onClick={() => {
                          if (orgDetails) {
                            setEditedName(orgDetails.name);
                            setIsEditingName(true);
                          }
                        }}
                        style={{ minHeight: "36px", padding: "8px 16px" }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Email Address */}
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <div className="form-row">
                  {isEditingEmail ? (
                    <div className="editing-row">
                      <input
                        type="email"
                        className="input-field"
                        value={editedEmail}
                        onChange={(e) => setEditedEmail(e.target.value)}
                        placeholder="Enter email address"
                      />
                      <div className="form-actions">
                        <button
                          className="btn-primary"
                          onClick={handleSaveEmail}
                          disabled={saveStatus === "saving"}
                          style={{ minHeight: "36px", padding: "8px 16px" }}
                        >
                          {saveStatus === "saving" ? "Saving..." : "Save"}
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={handleCancelEdit}
                          style={{ minHeight: "36px", padding: "8px 16px" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="view-row">
                      <span className="chip-mono">
                        {orgDetails?.email || "—"}
                      </span>
                      <button
                        className="btn-ghost"
                        onClick={() => {
                          if (orgDetails) {
                            setEditedEmail(orgDetails.email);
                            setIsEditingEmail(true);
                          }
                        }}
                        style={{ minHeight: "36px", padding: "8px 16px" }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Account ID */}
              <div className="form-group">
                <label className="form-label">Account ID</label>
                <div className="view-row">
                  <span
                    className="chip-mono"
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "260px",
                    }}
                  >
                    {orgDetails?.id || "—"}
                  </span>
                  <button
                    className="btn-ghost"
                    onClick={() =>
                      orgDetails?.id && handleCopyToClipboard(orgDetails.id)
                    }
                    style={{ minHeight: "36px", padding: "8px 16px" }}
                  >
                    {copySuccess ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Member Since */}
              <div className="form-group">
                <label className="form-label">Member Since</label>
                <span className="chip-mono">
                  {orgDetails ? formatDate(orgDetails.createdAt) : "—"}
                </span>
              </div>
            </div>
          </div>
        );

      case "appearance":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Appearance</h2>
            <p className="settings-page-subtitle">
              Customize how AnonVote looks for you.
            </p>

            {/* Theme Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Theme</h3>
                <p className="settings-section-description">
                  Choose your preferred theme
                </p>
              </div>
              <div className="theme-cards">
                <button
                  className={
                    "theme-card " + (theme === "light" ? "selected" : "")
                  }
                  onClick={() => setTheme("light")}
                >
                  <div className="theme-card-icon">
                    <SunIcon className="w-8 h-8" />
                  </div>
                  <span className="theme-card-label">Light</span>
                  <p className="theme-card-description">Clean and bright</p>
                  {theme === "light" && (
                    <span className="theme-card-checkmark">
                      <CheckIcon className="w-5 h-5" />
                    </span>
                  )}
                </button>
                <button
                  className={
                    "theme-card " + (theme === "dark" ? "selected" : "")
                  }
                  onClick={() => setTheme("dark")}
                >
                  <div className="theme-card-icon">
                    <MoonIcon className="w-8 h-8" />
                  </div>
                  <span className="theme-card-label">Dark</span>
                  <p className="theme-card-description">Easy on the eyes</p>
                  {theme === "dark" && (
                    <span className="theme-card-checkmark">
                      <CheckIcon className="w-5 h-5" />
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Brand Color Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Accent Color</h3>
                <p className="settings-section-description">
                  Choose your preferred accent color for buttons and highlights
                </p>
              </div>
              <div className="color-swatches">
                {[
                  { name: "Indigo", hex: "#4f46e5" },
                  { name: "Blue", hex: "#1c7ed6" },
                  { name: "Emerald", hex: "#059669" },
                  { name: "Violet", hex: "#7c3aed" },
                  { name: "Rose", hex: "#e11d48" },
                  { name: "Apple Blossom", hex: "#ba5a3c" },
                  { name: "Lime", hex: "#81b800" },
                ].map((color) => (
                  <button
                    key={color.name}
                    className={
                      "color-swatch " +
                      (selectedColor === color.hex ? "selected" : "")
                    }
                    style={{ backgroundColor: color.hex }}
                    title={color.name}
                    onClick={() => {
                      document.documentElement.style.setProperty(
                        "--brand-primary",
                        color.hex,
                      );
                      document.documentElement.style.setProperty(
                        "--brand-primary-dim",
                        color.hex,
                      );
                      document.documentElement.style.setProperty(
                        "--brand-primary-pale",
                        color.hex + "14",
                      );
                      localStorage.setItem("anonvote-accent", color.hex);
                      setSelectedColor(color.hex);
                    }}
                  >
                    {selectedColor === color.hex && (
                      <span className="color-swatch-checkmark">
                        <CheckIcon className="w-4 h-4" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Text Size</h3>
                <p className="settings-section-description">
                  Adjust the base font size for body text
                </p>
              </div>
              <div className="font-size-options">
                {[
                  { label: "Small", value: "13px" },
                  { label: "Default", value: "14px" },
                  { label: "Large", value: "16px" },
                ].map((size) => (
                  <button
                    key={size.label}
                    className={
                      "font-size-pill " +
                      (selectedFontSize === size.value ? "selected" : "")
                    }
                    onClick={() => {
                      document.documentElement.style.setProperty(
                        "--text-base",
                        size.value,
                      );
                      localStorage.setItem("anonvote-font-size", size.value);
                      setSelectedFontSize(size.value);
                    }}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case "stellar":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Stellar Settings</h2>
            <p className="settings-page-subtitle">
              Manage your blockchain configuration.
            </p>

            {/* Network Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Network</h3>
                <p className="settings-section-description">
                  Select your Stellar network
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Network</label>
                <div className="network-options">
                  <button
                    className={
                      "network-option " +
                      (network === "testnet" ? "active" : "")
                    }
                    onClick={() => setNetwork("testnet")}
                  >
                    <span className="badge badge-open">Testnet</span>
                  </button>
                  <button
                    className={
                      "network-option " +
                      (network === "mainnet" ? "active" : "")
                    }
                    onClick={() => setNetwork("mainnet")}
                  >
                    <span className="badge badge-closed">Mainnet</span>
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Stellar Expert URL</label>
                <div className="view-row">
                  <span
                    className="chip-mono chip-mono-truncate"
                    style={{ maxWidth: "260px" }}
                  >
                    {stellarExpertUrl}
                  </span>
                  <a
                    href={stellarExpertUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost"
                    style={{ minHeight: "36px", padding: "8px 12px" }}
                  >
                    <ExternalLinkIcon width="14" height="14" />
                  </a>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Transaction Signing</label>
                <div className="view-row">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      fontSize: "var(--text-sm)",
                      color: "var(--semantic-success)",
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--semantic-success)",
                        display: "inline-block",
                      }}
                    />
                    Automatic
                  </span>
                </div>
              </div>
            </div>

            {/* Stellar Account Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Stellar Account</h3>
                <p className="settings-section-description">
                  Your Stellar account information
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Public Key</label>
                <div className="view-row">
                  {orgStellarPublicKey ? (
                    <>
                      <span
                        className="chip-mono chip-mono-truncate"
                        style={{ maxWidth: "220px" }}
                      >
                        {orgStellarPublicKey}
                      </span>
                      <button
                        className="btn-ghost"
                        onClick={() =>
                          handleCopyToClipboard(orgStellarPublicKey)
                        }
                        style={{ minHeight: "36px", padding: "8px 16px" }}
                      >
                        Copy
                      </button>
                    </>
                  ) : (
                    <span
                      className="chip-mono"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      Not configured
                    </span>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Last Transaction</label>
                <div className="view-row">
                  {lastTransactionId ? (
                    <a
                      href={stellarExpertUrl + "/tx/" + lastTransactionId}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chip-mono"
                      style={{
                        color: "var(--brand-primary)",
                        textDecoration: "none",
                        maxWidth: "220px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {lastTransactionId}
                    </a>
                  ) : (
                    <span
                      className="chip-mono"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      No transactions yet
                    </span>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Total Transactions</label>
                <span className="chip-mono">{totalTransactions}</span>
              </div>
            </div>

            <div className="message message-warning">
              <span className="message-icon">
                <ExclamationTriangleIcon width="16" height="16" />
              </span>
              <span>
                Switching to Mainnet will use real XLM for transactions. Make
                sure your account is funded.
              </span>
            </div>
          </div>
        );

      case "security":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Security</h2>
            <p className="settings-page-subtitle">Keep your account safe.</p>

            {/* Change Password Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Change Password</h3>
                <p className="settings-section-description">
                  Update your password to keep your account secure
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Current Password</label>
                <input
                  type="password"
                  className="input-field"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  className="input-field"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                />
                {newPassword.length > 0 && newPassword.length < 8 && (
                  <p className="field-error">
                    Password must be at least 8 characters
                  </p>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password"
                  className="input-field"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                />
                {confirmPassword.length > 0 &&
                  newPassword !== confirmPassword && (
                    <p className="field-error">Passwords do not match</p>
                  )}
              </div>

              {passwordStatus === "success" && (
                <div
                  className="message message-success"
                  style={{ marginBottom: "var(--space-4)" }}
                >
                  <span className="message-icon">
                    <CheckIcon width="16" height="16" />
                  </span>
                  <span>Password updated successfully</span>
                </div>
              )}
              {passwordStatus === "error" && (
                <div
                  className="message message-error"
                  style={{ marginBottom: "var(--space-4)" }}
                >
                  <span className="message-icon">
                    <InfoCircledIcon width="16" height="16" />
                  </span>
                  <span>Failed to update password. Please try again.</span>
                </div>
              )}

              <button
                className="btn-primary"
                onClick={handleUpdatePassword}
                disabled={
                  passwordStatus === "saving" ||
                  newPassword.length < 8 ||
                  newPassword !== confirmPassword
                }
                style={{ minHeight: "48px", marginTop: "var(--space-2)" }}
              >
                {passwordStatus === "saving"
                  ? "Updating..."
                  : "Update Password"}
              </button>
            </div>

            {/* Rate Limiting Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">
                  Token Request Rate Limiting
                </h3>
                <p className="settings-section-description">
                  Control how many failed token requests are allowed per voter
                  IP before they are temporarily blocked.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Preset</label>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)",
                  }}
                >
                  {[
                    {
                      value: "off",
                      label: "Off",
                      desc: "No limit — unrestricted access",
                    },
                    {
                      value: "relaxed",
                      label: "Relaxed",
                      desc: "20 attempts per 15 minutes",
                    },
                    {
                      value: "standard",
                      label: "Standard",
                      desc: "10 attempts per 15 minutes (recommended)",
                    },
                    {
                      value: "strict",
                      label: "Strict",
                      desc: "5 attempts per 30 minutes",
                    },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-3)",
                        padding: "var(--space-3) var(--space-4)",
                        borderRadius: "var(--radius-md)",
                        border: `1px solid ${rateLimitPreset === opt.value ? "var(--brand-primary)" : "var(--border-soft)"}`,
                        background:
                          rateLimitPreset === opt.value
                            ? "var(--brand-primary-pale)"
                            : "var(--surface-sunken)",
                        cursor: "pointer",
                        transition:
                          "border-color var(--transition-fast), background var(--transition-fast)",
                      }}
                    >
                      <input
                        type="radio"
                        name="rateLimit"
                        value={opt.value}
                        checked={rateLimitPreset === opt.value}
                        onChange={() => setRateLimitPreset(opt.value)}
                        style={{ accentColor: "var(--brand-primary)" }}
                      />
                      <div>
                        <span
                          style={{
                            fontSize: "var(--text-sm)",
                            fontWeight: "var(--weight-medium)",
                            color: "var(--ink-primary)",
                            display: "block",
                          }}
                        >
                          {opt.label}
                        </span>
                        <span
                          style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--ink-muted)",
                          }}
                        >
                          {opt.desc}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {rateLimitInfo && (
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--ink-muted)",
                    marginBottom: "var(--space-3)",
                  }}
                >
                  Active: {rateLimitInfo.maxAttempts} attempts /{" "}
                  {rateLimitInfo.windowMinutes} min window
                </p>
              )}

              {rateLimitStatus === "success" && (
                <div
                  className="message message-success"
                  style={{ marginBottom: "var(--space-3)" }}
                >
                  <span className="message-icon">
                    <CheckIcon width="16" height="16" />
                  </span>
                  <span>Rate limit updated</span>
                </div>
              )}
              {rateLimitStatus === "error" && (
                <div
                  className="message message-error"
                  style={{ marginBottom: "var(--space-3)" }}
                >
                  <span className="message-icon">
                    <InfoCircledIcon width="16" height="16" />
                  </span>
                  <span>Failed to update rate limit</span>
                </div>
              )}

              <button
                className="btn-primary"
                onClick={() => handleSaveRateLimit(rateLimitPreset)}
                disabled={rateLimitSaving}
                style={{ minHeight: "44px" }}
              >
                {rateLimitSaving ? "Saving…" : "Save"}
              </button>
            </div>

            {/* Sessions Card */}
            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Active Sessions</h3>
                <p className="settings-section-description">
                  Manage your active sessions
                </p>
              </div>
              <div className="session-row">
                <div className="session-info">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      fontSize: "var(--text-sm)",
                      color: "var(--semantic-success)",
                      fontWeight: "var(--weight-medium)",
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--semantic-success)",
                        display: "inline-block",
                      }}
                    />
                    Current Session
                  </span>
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--ink-muted)",
                      marginLeft: "var(--space-2)",
                    }}
                  >
                    {getBrowserInfo()} — This device
                  </span>
                </div>
                <button
                  className="btn-ghost"
                  style={{ minHeight: "36px", padding: "8px 16px" }}
                >
                  Sign out all other sessions
                </button>
              </div>
            </div>

            {/* 2FA Card */}
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
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    fontSize: "var(--text-sm)",
                    color: "var(--semantic-warning)",
                    background: "var(--semantic-warning-light)",
                    padding: "4px 12px",
                    borderRadius: "var(--radius-pill)",
                    border: "1px solid var(--semantic-warning-border)",
                  }}
                >
                  <ExclamationTriangleIcon width="14" height="14" />
                  Not enabled
                </span>
              </div>
              <button
                className="btn-ghost"
                style={{
                  minHeight: "36px",
                  padding: "8px 16px",
                  marginTop: "var(--space-3)",
                }}
                onClick={() => {}}
              >
                Enable 2FA
              </button>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--ink-muted)",
                  marginTop: "var(--space-2)",
                }}
              >
                Coming soon
              </p>
            </div>
          </div>
        );

      case "danger":
        return (
          <div className="settings-content">
            <h2
              className="settings-title"
              style={{ color: "var(--semantic-error)" }}
            >
              Danger Zone
            </h2>
            <p className="settings-page-subtitle">
              Irreversible actions. Proceed with caution.
            </p>

            {/* Delete All Ballots */}
            <div
              className="card settings-card"
              style={{ borderColor: "var(--semantic-error-border)" }}
            >
              <div className="settings-section-header">
                <h3 className="settings-section-title">Delete All Ballots</h3>
                <p className="settings-section-description">
                  Permanently delete all your ballots and associated data. This
                  cannot be undone.
                </p>
              </div>
              {showDeleteBallotsConfirm ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-3)",
                  }}
                >
                  <label
                    className="form-label"
                    style={{ color: "var(--semantic-error)" }}
                  >
                    Type DELETE to confirm
                  </label>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <input
                      type="text"
                      className="input-field"
                      value={deleteBallotsConfirmText}
                      onChange={(e) =>
                        setDeleteBallotsConfirmText(e.target.value)
                      }
                      placeholder="Type DELETE"
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn-primary btn-danger"
                      onClick={handleDeleteAllBallots}
                      disabled={deleteBallotsConfirmText !== "DELETE"}
                      style={{ minHeight: "44px", padding: "8px 16px" }}
                    >
                      Confirm
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => setShowDeleteBallotsConfirm(false)}
                      style={{ minHeight: "44px", padding: "8px 16px" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteBallotsConfirm(true)}
                  style={{
                    background: "none",
                    border: "1px solid var(--semantic-error)",
                    color: "var(--semantic-error)",
                    fontFamily: "var(--font-display)",
                    fontWeight: "var(--weight-semibold)",
                    fontSize: "var(--text-sm)",
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    minHeight: "36px",
                    transition: "background var(--transition-fast)",
                  }}
                >
                  Delete All Ballots
                </button>
              )}
            </div>

            {/* Delete Account */}
            <div
              className="card settings-card"
              style={{ borderColor: "var(--semantic-error-border)" }}
            >
              <div className="settings-section-header">
                <h3 className="settings-section-title">Delete Account</h3>
                <p className="settings-section-description">
                  Permanently delete your organization account and all
                  associated data.
                </p>
              </div>
              {showDeleteAccountConfirm ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-3)",
                  }}
                >
                  <label
                    className="form-label"
                    style={{ color: "var(--semantic-error)" }}
                  >
                    Type your organization name to confirm
                  </label>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <input
                      type="text"
                      className="input-field"
                      value={deleteAccountConfirmText}
                      onChange={(e) =>
                        setDeleteAccountConfirmText(e.target.value)
                      }
                      placeholder={orgName || "Your organization name"}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn-primary btn-danger"
                      onClick={handleDeleteAccount}
                      disabled={deleteAccountConfirmText !== orgName}
                      style={{ minHeight: "44px", padding: "8px 16px" }}
                    >
                      Confirm
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => setShowDeleteAccountConfirm(false)}
                      style={{ minHeight: "44px", padding: "8px 16px" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn-primary btn-danger"
                  onClick={() => setShowDeleteAccountConfirm(true)}
                  style={{ minHeight: "36px", padding: "8px 16px" }}
                >
                  Delete Account
                </button>
              )}
            </div>
          </div>
        );

      case "contact":
        return (
          <div className="settings-content">
            <h2 className="settings-title">Contact Support</h2>
            <p className="settings-page-subtitle">
              Get help from the AnonVote team.
            </p>

            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Get in Touch</h3>
                <p className="settings-section-description">
                  Reach out to our support team
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Email Support</label>
                <a href="mailto:support@anonvote.com" className="link-dark">
                  support@anonvote.com
                </a>
              </div>
              <div className="form-group">
                <label className="form-label">GitHub Issues</label>
                <a
                  href="https://github.com/Just-Bamford/AnonVote/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-dark"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                  }}
                >
                  github.com/Just-Bamford/AnonVote/issues
                  <ExternalLinkIcon width="12" height="12" />
                </a>
              </div>
              <div className="form-group">
                <label className="form-label">Documentation</label>
                <a
                  href="https://github.com/Just-Bamford/AnonVote"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-dark"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                  }}
                >
                  github.com/Just-Bamford/AnonVote
                  <ExternalLinkIcon width="12" height="12" />
                </a>
              </div>
              <div className="form-group">
                <label className="form-label">Response Time</label>
                <span
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--ink-muted)",
                  }}
                >
                  Usually within 24 hours
                </span>
              </div>
            </div>

            <div className="card settings-card">
              <div className="settings-section-header">
                <h3 className="settings-section-title">System Information</h3>
                <p className="settings-section-description">
                  Version and environment details
                </p>
              </div>
              {[
                { label: "Version", value: "v1.1.0" },
                { label: "Environment", value: "Testnet" },
                { label: "Frontend", value: "React 18 + Vite" },
                { label: "Blockchain", value: "Stellar" },
              ].map((item) => (
                <div key={item.label} className="form-group">
                  <label className="form-label">{item.label}</label>
                  <span className="chip-mono">{item.value}</span>
                </div>
              ))}
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
          maxWidth: "1000px",
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
                    className={
                      "settings-sidebar-item " +
                      (activeSection === item.id ? "active" : "") +
                      (item.id === "danger" ? " danger" : "")
                    }
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

          {/* Content — Radix ScrollArea */}
          <ScrollArea.Root style={{ flex: 1, minWidth: 0 }}>
            <ScrollArea.Viewport style={{ height: "100%", width: "100%" }}>
              <main className="settings-content-area">{renderContent()}</main>
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar
              orientation="vertical"
              style={{
                display: "flex",
                userSelect: "none",
                touchAction: "none",
                padding: "2px",
                width: "8px",
                background: "var(--surface-sunken)",
                borderRadius: "var(--radius-pill)",
              }}
            >
              <ScrollArea.Thumb
                style={{
                  flex: 1,
                  background: "var(--border-strong)",
                  borderRadius: "var(--radius-pill)",
                  position: "relative",
                  cursor: "pointer",
                }}
              />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </div>
      </div>

      {/* Global toast for avatar actions */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

function getIcon(name: string) {
  const icons: Record<string, React.ReactNode> = {
    profile: <PersonIcon className="w-5 h-5" />,
    palette: <SunIcon className="w-5 h-5" />,
    stellar: <CheckCircledIcon className="w-5 h-5" />,
    shield: <LockClosedIcon className="w-5 h-5" />,
    alert: <ExclamationTriangleIcon className="w-5 h-5" />,
    contact: <ChatBubbleIcon className="w-5 h-5" />,
  };
  return icons[name] || null;
}
