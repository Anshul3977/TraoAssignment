"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("AppErrorBoundary", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="mx-auto max-w-lg px-4 py-16"
          role="alert"
          data-testid="error-boundary"
        >
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            {this.state.error.message || "The page hit an unexpected error."}
          </p>
          <button
            type="button"
            className="mt-6 rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
