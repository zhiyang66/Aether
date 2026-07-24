import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Aether]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            height: "100%",
            display: "grid",
            placeItems: "center",
            background: "oklch(0.16 0.012 250)",
            color: "oklch(0.93 0.01 250)",
            fontFamily: "Segoe UI, system-ui, sans-serif",
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 440,
              border: "1px solid oklch(0.32 0.015 250)",
              borderRadius: 10,
              background: "oklch(0.20 0.012 250)",
              padding: 24,
            }}
          >
            <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>界面出错了</h1>
            <p style={{ fontSize: 13, color: "oklch(0.65 0.02 250)", lineHeight: 1.5 }}>
              {this.state.error.message || "未知错误"}
            </p>
            <button
              type="button"
              style={{
                marginTop: 16,
                padding: "8px 14px",
                borderRadius: 6,
                border: "1px solid oklch(0.32 0.015 250)",
                background: "oklch(0.72 0.14 195)",
                color: "oklch(0.16 0.01 250)",
                fontWeight: 600,
                cursor: "pointer",
              }}
              onClick={() => {
                this.setState({ error: null });
                window.location.href = "/";
              }}
            >
              返回工作台
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
