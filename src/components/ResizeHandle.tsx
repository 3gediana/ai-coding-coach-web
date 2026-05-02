import { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';

/**
 * VSCode 风格的可拖拽分隔条
 *
 * - direction='right'：handle 在元素右边，向右拖增加宽度
 * - direction='left'：handle 在元素左边，向左拖增加宽度
 *
 * 视觉：1px 宽的细线 + 悬停/拖拽时显示 4px 高亮带（VSCode 风格）
 */
export function ResizeHandle({
  direction,
  currentWidth,
  onResize,
  min = 200,
  max = 800,
}: {
  direction: 'left' | 'right';
  currentWidth: number;
  onResize: (width: number) => void;
  min?: number;
  max?: number;
}) {
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const isDraggingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startW: currentWidth };
    isDraggingRef.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const rawDelta = ev.clientX - dragRef.current.startX;
      const delta = direction === 'right' ? rawDelta : -rawDelta;
      const newW = Math.max(min, Math.min(max, dragRef.current.startW + delta));
      onResize(newW);
    };

    const onUp = () => {
      dragRef.current = null;
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      cleanupRef.current = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    cleanupRef.current = onUp;
  };

  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        // 4px 宽的可点击区域（更容易抓），但视觉上只显示 1px 线
        'group relative w-1 cursor-col-resize flex-shrink-0',
        'hover:bg-accent/30 active:bg-accent/50 transition-colors',
      )}
      title="拖动调整宽度"
    >
      {/* 悬停时显示更明显的高亮带（VSCode 风格） */}
      <div className="absolute inset-y-0 -inset-x-px group-hover:bg-accent/30 group-active:bg-accent/50 transition-colors" />
    </div>
  );
}
