import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  NotificationProvider,
  useNotifications,
} from "../context/NotificationContext";

// Mock API calls made inside NotificationProvider
vi.mock("../api/client", () => ({
  getBallots: vi.fn().mockResolvedValue({ data: { data: [] } }),
  getAudit: vi.fn().mockResolvedValue({ data: { data: { votesCast: 0 } } }),
}));

function TestConsumer() {
  const { notifications, unreadCount, addNotification, markAllAsRead } =
    useNotifications();
  return (
    <div>
      <span data-testid="count">{unreadCount}</span>
      <span data-testid="total">{notifications.length}</span>
      <button
        onClick={() =>
          addNotification({
            type: "ballot_created",
            title: "Test",
            message: "Hello",
          })
        }
      >
        Add
      </button>
      <button onClick={markAllAsRead}>Mark read</button>
      {notifications.map((n) => (
        <div key={n.id} data-testid="notification">
          {n.title}
        </div>
      ))}
    </div>
  );
}

function renderWithProvider() {
  return render(
    <NotificationProvider>
      <TestConsumer />
    </NotificationProvider>,
  );
}

describe("NotificationContext", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts with zero notifications on fresh localStorage", () => {
    renderWithProvider();
    expect(screen.getByTestId("total").textContent).toBe("0");
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("addNotification increases count", async () => {
    renderWithProvider();
    await act(async () => {
      screen.getByText("Add").click();
    });
    expect(screen.getByTestId("total").textContent).toBe("1");
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("added notification appears in list", async () => {
    renderWithProvider();
    await act(async () => {
      screen.getByText("Add").click();
    });
    expect(screen.getByTestId("notification").textContent).toBe("Test");
  });

  it("markAllAsRead sets unreadCount to 0", async () => {
    renderWithProvider();
    await act(async () => {
      screen.getByText("Add").click();
    });
    expect(screen.getByTestId("count").textContent).toBe("1");
    await act(async () => {
      screen.getByText("Mark read").click();
    });
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("notifications are capped at 50", async () => {
    renderWithProvider();
    await act(async () => {
      for (let i = 0; i < 55; i++) {
        screen.getByText("Add").click();
      }
    });
    const total = parseInt(screen.getByTestId("total").textContent!);
    expect(total).toBeLessThanOrEqual(50);
  });
});
