import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            background: "var(--surface-base, #f9fafb)",
          }}
          data-testid="error-boundary-fallback"
        >
          <div
            style={{
              maxWidth: "420px",
              width: "100%",
              padding: "2rem",
              borderRadius: "1rem",
              border: "1px solid var(--border-soft, #e5e7eb)",
              background: "var(--surface-raised, #ffffff)",
              textAlign: "center",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "var(--semantic-error-bg, #fee2e2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 1rem",
                fontSize: "1.5rem",
              }}
            >
              ⚠
            </div>
            <h2
              style={{
                fontFamily: "var(--font-display, inherit)",
                fontWeight: 700,
                fontSize: "1.25rem",
                marginBottom: "0.5rem",
                color: "var(--ink-primary, #111827)",
              }}
            >
              Something went wrong
            </h2>
            <p
              style={{
                color: "var(--ink-secondary, #6b7280)",
                fontSize: "0.875rem",
                marginBottom: "1.5rem",
                lineHeight: 1.6,
              }}
            >
              An unexpected error occurred. Your data is safe — reload the page to try again.
            </p>
            <div
              style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}
            >
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--border-soft, #e5e7eb)",
                  background: "var(--surface-raised, #fff)",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  color: "var(--ink-primary, #111827)",
                }}
                data-testid="error-boundary-retry"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "0.5rem",
                  background: "var(--brand-primary, #4f46e5)",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
                data-testid="error-boundary-reload"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
