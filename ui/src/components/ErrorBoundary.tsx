import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render-time throws (e.g. an odd hunk react-diff-view can't render) so
 *  one file can't blank the whole cockpit. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return this.props.fallback?.(error) ?? <p className="error">Something went wrong: {error.message}</p>;
    }
    return this.props.children;
  }
}
