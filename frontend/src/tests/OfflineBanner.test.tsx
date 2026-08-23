import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import OfflineBanner from "../components/OfflineBanner";

afterEach(() => {
  // Restore navigator.onLine to true after each test
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    writable: true,
    value: true,
  });
});

describe("OfflineBanner", () => {
  it("is not visible when the browser is online", () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      writable: true,
      value: true,
    });
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  it("renders the banner when the browser starts offline", () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      writable: true,
      value: false,
    });
    render(<OfflineBanner />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
  });

  it("contains an informative message about offline status", () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      writable: true,
      value: false,
    });
    render(<OfflineBanner />);
    expect(screen.getByTestId("offline-banner")).toHaveTextContent(
      /you are offline/i,
    );
  });

  it("appears when the 'offline' event fires while online", () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      writable: true,
      value: true,
    });
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();

    act(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        writable: true,
        value: false,
      });
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
  });

  it("disappears when the 'online' event fires while offline", () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      writable: true,
      value: false,
    });
    render(<OfflineBanner />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();

    act(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        writable: true,
        value: true,
      });
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  it("has role='status' for accessibility", () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      writable: true,
      value: false,
    });
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
