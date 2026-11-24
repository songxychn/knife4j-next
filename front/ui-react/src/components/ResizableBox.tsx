import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './ResizableBox.css';

export interface ResizableBoxProps {
  /** Custom fixed height in px; undefined lets content size naturally up to defaultMaxHeight. */
  height?: number;
  /** Natural maximum height when unresized; also used as fallback start height when layout measurement is 0. */
  defaultMaxHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Called with a clamped pixel height while resizing, or undefined when reset to default. */
  onHeightChange: (height: number | undefined) => void;
  /** Accessible name for the horizontal drag separator. */
  handleLabel: string;
  /** Tooltip text for the drag handle. */
  resetTitle?: string;
  /** Optional stable element id for the resized content container. */
  controlsId?: string;
  className?: string;
  children: ReactNode;
}

const KEYBOARD_STEP = 24;
const KEYBOARD_LARGE_STEP = 96;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export default function ResizableBox({
  height,
  defaultMaxHeight = 400,
  minHeight = 120,
  maxHeight = 1600,
  onHeightChange,
  handleLabel,
  resetTitle,
  controlsId,
  className,
  children,
}: ResizableBoxProps) {
  const generatedId = useId();
  const contentId = controlsId ?? generatedId;
  const contentRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const currentHeight = () => {
    if (height !== undefined) return height;
    const measured = contentRef.current?.getBoundingClientRect().height ?? 0;
    if (measured > 0) return clamp(measured, minHeight, maxHeight);
    return clamp(defaultMaxHeight, minHeight, maxHeight);
  };

  const beginDrag = (
    startY: number,
    moveEventName: 'pointermove' | 'mousemove',
    endEventNames: readonly ('pointerup' | 'pointercancel' | 'mouseup')[],
  ) => {
    if (cleanupRef.current) return;
    const startHeight = currentHeight();
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    setDragging(true);

    const handleMove = (moveEvent: PointerEvent | MouseEvent) => {
      const next = clamp(startHeight + (moveEvent.clientY - startY), minHeight, maxHeight);
      onHeightChange(next);
    };

    const cleanup = () => {
      window.removeEventListener(moveEventName, handleMove as EventListener);
      for (const endEvent of endEventNames) {
        window.removeEventListener(endEvent, cleanup);
      }
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      cleanupRef.current = null;
      setDragging(false);
    };

    cleanupRef.current = cleanup;
    window.addEventListener(moveEventName, handleMove as EventListener);
    for (const endEvent of endEventNames) {
      window.addEventListener(endEvent, cleanup);
    }
  };

  const ariaValueNow = height ?? clamp(defaultMaxHeight, minHeight, maxHeight);

  return (
    <div className={['knife4j-resizable-box', className].filter(Boolean).join(' ')} data-resizable-box>
      <div
        ref={contentRef}
        id={contentId}
        className="knife4j-resizable-box-content"
        data-resized={height !== undefined ? 'true' : 'false'}
        style={height !== undefined ? { height } : undefined}
      >
        {children}
      </div>
      <div
        role="separator"
        tabIndex={0}
        className="knife4j-resizable-box-handle"
        data-resize-handle="vertical"
        data-dragging={dragging ? 'true' : 'false'}
        aria-label={handleLabel}
        aria-orientation="horizontal"
        aria-valuenow={ariaValueNow}
        aria-valuetext={`${ariaValueNow}px`}
        aria-valuemin={minHeight}
        aria-valuemax={maxHeight}
        aria-controls={contentId}
        title={resetTitle}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          beginDrag(event.clientY, 'pointermove', ['pointerup', 'pointercancel']);
        }}
        onMouseDown={(event) => {
          if (typeof PointerEvent !== 'undefined' || event.button !== 0) return;
          event.preventDefault();
          beginDrag(event.clientY, 'mousemove', ['mouseup']);
        }}
        onDoubleClick={() => {
          onHeightChange(undefined);
        }}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
          const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
          let next: number;
          switch (event.key) {
            case 'ArrowDown':
              next = currentHeight() + step;
              break;
            case 'ArrowUp':
              next = currentHeight() - step;
              break;
            case 'Home':
              next = minHeight;
              break;
            case 'End':
              next = maxHeight;
              break;
            default:
              return;
          }
          event.preventDefault();
          event.stopPropagation();
          onHeightChange(clamp(next, minHeight, maxHeight));
        }}
      />
    </div>
  );
}
