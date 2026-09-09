import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import Toast from "../components/Toast";

describe("Toast", () => {
  it("renders success message", () => {
    render(<Toast message="Saved!" type="success" onClose={vi.fn()} />);
    expect(screen.getByText("Saved!")).toBeInTheDocument();
  });

  it("renders error message", () => {
    render(
      <Toast message="Something went wrong" type="error" onClose={vi.fn()} />,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("has role=status for success", () => {
    const { container } = render(
      <Toast message="Done" type="success" onClose={vi.fn()} />,
    );
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it("has role=alert for error", () => {
    const { container } = render(
      <Toast message="Error" type="error" onClose={vi.fn()} />,
    );
    expect(container.querySelector('[role="alert"]')).toBeInTheDocument();
  });

  it("calls onClose after 3 seconds", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast message="Test" type="success" onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(3000));
    expect(onClose).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
