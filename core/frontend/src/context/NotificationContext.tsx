import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getBallots, getAudit } from "../api/client";

export type NotificationType =
  | "ballot_created"
  | "ballot_closed"
  | "results_published"
  | "vote_cast"
  | "warning";

export interface Notification {
  id: number;
  title: string;
  message: string;
  time: Date;
  read: boolean;
  type: NotificationType;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAllAsRead: () => void;
  addNotification: (
    notification: Omit<Notification, "id" | "time" | "read">,
  ) => void;
  clearNotifications: () => void;
  setUserId: (userId: string | null) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined,
);

const STORAGE_KEY_PREFIX = "anonvote-notifications_";
const VOTE_COUNTS_KEY_PREFIX = "anonvote-vote-counts_";

function getStorageKey(userId: string | null): string {
  return userId
    ? `${STORAGE_KEY_PREFIX}${userId}`
    : STORAGE_KEY_PREFIX + "default";
}

function getVoteCountsKey(userId: string | null): string {
  return userId
    ? `${VOTE_COUNTS_KEY_PREFIX}${userId}`
    : VOTE_COUNTS_KEY_PREFIX + "default";
}

function loadVoteCounts(userId: string | null): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(getVoteCountsKey(userId)) || "{}");
  } catch {
    return {};
  }
}

function saveVoteCounts(userId: string | null, counts: Record<string, number>) {
  localStorage.setItem(getVoteCountsKey(userId), JSON.stringify(counts));
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    try {
      const saved = localStorage.getItem(getStorageKey(null));
      if (saved) {
        const parsed = JSON.parse(saved);
        // Restore Date objects
        return parsed.map((n: any) => ({ ...n, time: new Date(n.time) }));
      }
    } catch {}
    return [];
  });

  // When userId changes, load the user's notifications
  useEffect(() => {
    const key = getStorageKey(userId);
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Restore Date objects
        setNotifications(
          parsed.map((n: any) => ({ ...n, time: new Date(n.time) })),
        );
      } else {
        setNotifications([]);
      }
    } catch {
      setNotifications([]);
    }
  }, [userId]);

  useEffect(() => {
    const key = getStorageKey(userId);
    localStorage.setItem(key, JSON.stringify(notifications));
  }, [notifications, userId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const addNotification = useCallback(
    (notification: Omit<Notification, "id" | "time" | "read">) => {
      setNotifications((prev) => {
        const newNotification: Notification = {
          ...notification,
          id: Date.now(),
          time: new Date(),
          read: false,
        };
        return [newNotification, ...prev].slice(0, 50); // keep last 50
      });
    },
    [],
  );

  const clearNotifications = () => {
    setNotifications([]);
    const key = getStorageKey(userId);
    localStorage.removeItem(key);
    const voteKey = getVoteCountsKey(userId);
    localStorage.removeItem(voteKey);
  };

  // Poll for real events every 30 seconds
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await getBallots();
        const ballots = res.data.data;
        if (!ballots?.length) return;

        const voteCounts = loadVoteCounts(userId);
        const updatedCounts: Record<string, number> = { ...voteCounts };

        for (const ballot of ballots) {
          if (ballot.status !== "OPEN") continue;
          try {
            const auditRes = await getAudit(ballot.id);
            const { votesCast } = auditRes.data.data;
            const prev = voteCounts[ballot.id] ?? votesCast; // initialise silently

            if (voteCounts[ballot.id] !== undefined && votesCast > prev) {
              const newVotes = votesCast - prev;
              addNotification({
                type: "vote_cast",
                title: "New vote cast",
                message: `${newVotes} new vote${newVotes > 1 ? "s" : ""} on "${ballot.topic}" — ${votesCast} total`,
              });
            }

            updatedCounts[ballot.id] = votesCast;
          } catch {}
        }

        saveVoteCounts(userId, updatedCounts);
      } catch {}
    }

    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [addNotification, userId]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAllAsRead,
        addNotification,
        clearNotifications,
        setUserId,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error(
      "useNotifications must be used within a NotificationProvider",
    );
  }
  return context;
}
