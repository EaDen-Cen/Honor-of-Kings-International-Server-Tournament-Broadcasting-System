import { useEffect, useRef, type ReactNode } from 'react';
import './control.css';
export function ControlDraftWorkspace({ monitor, children }: {monitor:ReactNode;children:ReactNode}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const board = root.current?.querySelector('.compact-board');
    if (!board) return;
    const observer = new ResizeObserver(() => root.current?.style.setProperty('--monitor-height', (board.getBoundingClientRect().height + 8) + 'px'));
    observer.observe(board); return () => observer.disconnect();
  }, []);
  return <div id="draft-workspace" ref={root} className="control-draft-workspace"><aside className="control-monitor">{monitor}</aside>{children}</div>;
}
