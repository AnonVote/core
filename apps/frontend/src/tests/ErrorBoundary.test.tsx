import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "../components/ErrorBoundary";

// A component that throws on first render when `shouldThrow` is true
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test explosion");
  return <div data-testid="safe-content">All good</div>;
}

// Suppress console.error output from the boundary during tests
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("safe-content")).toBeInTheDocument();
  });

  it("renders the default fallback UI when a child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("does not render the child content when an error is caught", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.queryByTestId("safe-content")).not.toBeInTheDocument();
  });

  it("renders a 'Try Again' button in the fallback", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary-retry")).toBeInTheDocument();
  });

  it("renders a 'Reload Page' button in the fallback", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary-reload")).toBeInTheDocument();
  });

  it("renders a custom fallback when the `fallback` prop is provided", () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom</div>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("error-boundary-fallback")).not.toBeInTheDocument();
  });

  it("resets and re-renders children when 'Try Again' is clicked", () => {
    // We need a controlled Bomb that only throws on the first render
    let callCount = 0;

    function RecoveringBomb() {
      callCount += 1;
      if (callCount === 1) throw new Error("First render error");
      return <div data-testid="recovered-content">Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <RecoveringBomb />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("error-boundary-retry"));

    expect(screen.getByTestId("recovered-content")).toBeInTheDocument();
  });

  it("shows an informative message to the user in the fallback", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/your data is safe/i)).toBeInTheDocument();
  });
});
