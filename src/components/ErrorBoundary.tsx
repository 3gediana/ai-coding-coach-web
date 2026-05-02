import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

type ErrorBoundaryProps = {
  children: React.ReactNode;
  title?: string;
  compact?: boolean;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    const title = this.props.title ?? '界面组件异常';
    const message = this.state.error.message || String(this.state.error);
    return (
      <div className={this.props.compact ? 'p-3 text-xs' : 'min-h-screen flex items-center justify-center p-6 bg-bg text-ink'}>
        <div className="max-w-xl w-full rounded-lg border border-bad/40 bg-bad/10 p-4 shadow-soft">
          <div className="flex items-center gap-2 text-bad font-semibold">
            <AlertTriangle size={16} />
            <span>{title}</span>
          </div>
          <div className="mt-2 text-[12px] text-ink-mute break-words">{message}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => this.setState({ error: null })}
            >
              <RefreshCw size={12} />
              重试渲染
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => window.location.reload()}
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
