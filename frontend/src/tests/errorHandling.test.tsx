import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AxiosError } from "axios";
import ErrorBoundary from "../components/ErrorBoundary";
import ErrorMessage from "../components/ErrorMessage";
import ErrorPage from "../components/ErrorPage";
import { parseError, getErrorMessage, isRetryableError } from "../utils/errorHandler";

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>Test Content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Test Content")).toBeInTheDocument();
  });

  it("renders error UI when child component throws", () => {
    const ThrowError = () => {
      throw new Error("Test error");
    };

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
    expect(screen.getByText("Try Again")).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("resets error state when Try Again is clicked", () => {
    let shouldThrow = true;
    const ComponentThatThrows = () => {
      if (shouldThrow) {
        throw new Error("Test error");
      }
      return <div>Success</div>;
    };

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(
      <ErrorBoundary>
        <ComponentThatThrows />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText("Try Again"));

    rerender(
      <ErrorBoundary>
        <ComponentThatThrows />
      </ErrorBoundary>
    );

    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});

describe("ErrorMessage", () => {
  it("renders error message with title", () => {
    render(
      <ErrorMessage
        title="Error Title"
        message="Error message content"
      />
    );

    expect(screen.getByText("Error Title")).toBeInTheDocument();
    expect(screen.getByText("Error message content")).toBeInTheDocument();
  });

  it("renders with different severities", () => {
    const { rerender } = render(
      <ErrorMessage message="Test" severity="error" />
    );
    expect(screen.getByRole("alert")).toHaveClass("bg-red-50");

    rerender(<ErrorMessage message="Test" severity="warning" />);
    expect(screen.getByRole("alert")).toHaveClass("bg-yellow-50");

    rerender(<ErrorMessage message="Test" severity="info" />);
    expect(screen.getByRole("alert")).toHaveClass("bg-blue-50");
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <ErrorMessage
        message="Test message"
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders action button when provided", () => {
    const onAction = vi.fn();
    render(
      <ErrorMessage
        message="Test message"
        action={{ label: "Retry", onClick: onAction }}
      />
    );

    const button = screen.getByText("Retry");
    expect(button).toBeInTheDocument();
    
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorPage", () => {
  it("renders with default props", () => {
    render(<ErrorPage />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/We encountered an unexpected error/)).toBeInTheDocument();
    expect(screen.getByText("Try Again")).toBeInTheDocument();
    expect(screen.getByText("Go to Home")).toBeInTheDocument();
  });

  it("calls onRetry when Try Again is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorPage onRetry={onRetry} />);

    fireEvent.click(screen.getByText("Try Again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides buttons based on props", () => {
    render(
      <ErrorPage
        showRetry={false}
        showHome={false}
        showBack={true}
      />
    );

    expect(screen.queryByText("Try Again")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Home")).not.toBeInTheDocument();
    expect(screen.getByText("Go Back")).toBeInTheDocument();
  });
});

describe("parseError", () => {
  it("parses network errors", () => {
    const error = {
      isAxiosError: true,
      message: "Network Error",
      response: undefined,
    } as AxiosError;

    const parsed = parseError(error);
    expect(parsed.title).toBe("Network Error");
    expect(parsed.retryable).toBe(true);
  });

  it("parses timeout errors", () => {
    const error = {
      isAxiosError: true,
      code: "ECONNABORTED",
      message: "timeout of 5000ms exceeded",
      response: undefined,
    } as AxiosError;

    const parsed = parseError(error);
    expect(parsed.title).toBe("Request Timeout");
    expect(parsed.retryable).toBe(true);
  });

  it("parses 401 errors", () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 401,
        data: {},
      },
    } as AxiosError;

    const parsed = parseError(error);
    expect(parsed.title).toBe("Unauthorized");
    expect(parsed.statusCode).toBe(401);
    expect(parsed.retryable).toBe(false);
  });

  it("parses 404 errors", () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 404,
        data: {
          message: "Ballot not found",
        },
      },
    } as AxiosError;

    const parsed = parseError(error);
    expect(parsed.title).toBe("Not Found");
    expect(parsed.message).toBe("Ballot not found");
    expect(parsed.statusCode).toBe(404);
  });

  it("parses 429 rate limit errors", () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 429,
        data: {},
      },
    } as AxiosError;

    const parsed = parseError(error);
    expect(parsed.title).toBe("Too Many Requests");
    expect(parsed.retryable).toBe(true);
  });

  it("parses 500 server errors", () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 500,
        data: {},
      },
    } as AxiosError;

    const parsed = parseError(error);
    expect(parsed.title).toBe("Server Error");
    expect(parsed.retryable).toBe(true);
  });

  it("handles custom error codes", () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          error: "INVALID_TOKEN",
        },
      },
    } as AxiosError;

    const parsed = parseError(error);
    expect(parsed.title).toBe("Invalid Token");
    expect(parsed.retryable).toBe(false);
  });

  it("handles Error objects", () => {
    const error = new Error("Something went wrong");
    const parsed = parseError(error);
    
    expect(parsed.message).toBe("Something went wrong");
    expect(parsed.retryable).toBe(false);
  });

  it("handles string errors", () => {
    const parsed = parseError("Error message");
    expect(parsed.message).toBe("Error message");
  });

  it("handles unknown error types", () => {
    const parsed = parseError({ unknown: "type" });
    expect(parsed.title).toBe("Error");
    expect(parsed.message).toBe("An unexpected error occurred. Please try again.");
  });
});

describe("Error utility functions", () => {
  it("getErrorMessage extracts message", () => {
    const error = new Error("Test error");
    expect(getErrorMessage(error)).toBe("Test error");
  });

  it("isRetryableError identifies retryable errors", () => {
    const networkError = {
      isAxiosError: true,
      response: undefined,
    } as AxiosError;

    const authError = {
      isAxiosError: true,
      response: { status: 401, data: {} },
    } as AxiosError;

    expect(isRetryableError(networkError)).toBe(true);
    expect(isRetryableError(authError)).toBe(false);
  });
});
