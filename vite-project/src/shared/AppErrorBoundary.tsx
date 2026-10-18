import { Component, type ReactNode } from 'react';

/** Keep a failed lazy module or render from leaving operators on an empty page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-load-error" role="alert">
      <h1>页面暂时无法显示 / Page unavailable</h1>
      <p>请重新加载以读取最新比赛状态。未确认的操作不会自动重复执行。</p>
      <p>Reload to fetch the current match state. Unconfirmed actions will not be replayed.</p>
      <button type="button" onClick={() => location.reload()}>重新加载 / Reload</button>
    </main>;
  }
}
