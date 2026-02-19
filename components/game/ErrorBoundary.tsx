'use client';

/**
 * ErrorBoundary
 *
 * Catches React errors and displays a fallback UI.
 * Calls the optional onError callback for external error reporting.
 * Always logs errors to console for debugging visibility.
 */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
  /** Called when an error is caught (for external error reporting) */
  onError?: (error: Error, context: { component: string; errorId: string; componentStack?: string }) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

/** Generate a short error ID for user reference */
function generateErrorId(): string {
  return `ERR-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, errorId: generateErrorId() };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const context = {
      component: 'ErrorBoundary',
      errorId: this.state.errorId!,
      componentStack: info.componentStack ?? undefined,
    };

    // Always log errors for debugging visibility
    console.error(
      `[ErrorBoundary] Error caught (${context.errorId}):`,
      error.message,
      '\nStack:', error.stack,
      '\nComponent Stack:', context.componentStack
    );

    // Call external error reporter if provided
    this.props.onError?.(error, context);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorId: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 gap-4">
          <h2 className="text-xl font-bold text-red-400">Something went wrong</h2>
          <p className="text-gray-400 text-sm max-w-md text-center">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          {this.state.errorId && (
            <p className="text-gray-500 text-xs font-mono">
              Error ID: {this.state.errorId}
            </p>
          )}
          <button
            onClick={this.handleReset}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
