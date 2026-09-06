import { useRef, useEffect, useState } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { useNotifications } from "../context/NotificationContext";
import { BellIcon } from "@radix-ui/react-icons";
import "./Navbar.css";

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function NotificationDropdown() {
  const { notifications, markAllAsRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const recentNotifications = [...notifications]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 10);

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="navbar-bell"
        aria-label="Notifications"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <BellIcon width="20" height="20" />
        {notifications.some((n) => !n.read) && (
          <span className="navbar-bell-dot" aria-hidden="true" />
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="navbar-dropdown"
          role="menu"
          aria-label="Notifications"
          style={{
            minWidth: "280px",
            maxWidth: "280px",
            top: "calc(100% + 8px)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "var(--space-3) var(--space-4)",
              borderBottom: "1px solid var(--border-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: "var(--weight-semibold)",
                fontSize: "var(--text-sm)",
                color: "var(--ink-primary)",
              }}
            >
              Notifications
            </span>
            <button
              onClick={markAllAsRead}
              className="navbar-dropdown-item"
              aria-label="Mark all notifications as read"
              style={{
                width: "auto",
                padding: "2px 8px",
                fontSize: "var(--text-xs)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Mark all read
            </button>
          </div>

          {/* Radix ScrollArea */}
          <ScrollArea.Root style={{ height: "320px" }}>
            <ScrollArea.Viewport style={{ height: "100%", width: "100%" }}>
              {notifications.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-6) var(--space-4)",
                  }}
                >
                  <BellIcon
                    width="24"
                    height="24"
                    style={{ color: "var(--ink-muted)" }}
                  />
                  <span
                    style={{
                      fontSize: "var(--text-sm)",
                      color: "var(--ink-muted)",
                    }}
                  >
                    No notifications yet
                  </span>
                </div>
              ) : (
                recentNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="navbar-dropdown-item"
                    style={{
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: "var(--space-1)",
                      borderLeft: !notification.read
                        ? "3px solid var(--brand-primary)"
                        : "3px solid transparent",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: "var(--weight-medium)",
                        fontSize: "var(--text-sm)",
                        color: "var(--ink-primary)",
                      }}
                    >
                      {notification.title}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--ink-muted)",
                      }}
                    >
                      {notification.message}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-xs)",
                        color: "var(--ink-muted)",
                      }}
                    >
                      {timeAgo(notification.time)}
                    </span>
                  </div>
                ))
              )}
            </ScrollArea.Viewport>

            {/* Scrollbar */}
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
                transition: "background var(--transition-fast)",
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
      )}
    </div>
  );
}
