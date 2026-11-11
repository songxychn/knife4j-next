import { forwardRef, type HTMLAttributes } from 'react';
import './ResizableSeparator.css';

interface ResizableSeparatorProps extends HTMLAttributes<HTMLSpanElement> {
  value: number;
  min: number;
  max: number;
  onValueChange: (value: number) => void;
  label: string;
  controls?: string;
  // react-resizable adds this to custom handles; it is not a DOM attribute.
  handleAxis?: string;
}

const ResizableSeparator = forwardRef<HTMLSpanElement, ResizableSeparatorProps>(function ResizableSeparator(
  {
    value,
    min,
    max,
    onValueChange,
    label,
    controls,
    className,
    handleAxis,
    onKeyDown,
    onClick,
    tabIndex = 0,
    ...restProps
  },
  ref,
) {
  return (
    <span
      {...restProps}
      ref={ref}
      className={['knife4j-resizable-separator', className].filter(Boolean).join(' ')}
      data-resize-axis={handleAxis}
      role="separator"
      tabIndex={tabIndex}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuetext={`${value}px`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-controls={controls}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        let next: number;
        switch (event.key) {
          case 'ArrowLeft':
            next = value - 10;
            break;
          case 'ArrowRight':
            next = value + 10;
            break;
          case 'Home':
            next = min;
            break;
          case 'End':
            next = max;
            break;
          default:
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        onValueChange(Math.min(max, Math.max(min, next)));
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    />
  );
});

export default ResizableSeparator;
