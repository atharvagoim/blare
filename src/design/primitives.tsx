import type { CSSProperties, ReactNode } from 'react';

/** A Figma text node: text centred on `cx`, box top at `top`. Matches Figma's export exactly. */
export function T({
  cx,
  top,
  size,
  color = 'var(--fg)',
  width = 272,
  children,
  as: Tag = 'p',
  style,
  id,
}: {
  cx: number;
  top: number;
  size: number;
  color?: string;
  width?: number;
  children: ReactNode;
  as?: 'p' | 'h1' | 'h2' | 'span' | 'label';
  style?: CSSProperties;
  id?: string;
}) {
  return (
    <Tag id={id} className="t" style={{ left: cx - width / 2, top, width, fontSize: size, color, ...style }}>
      {children}
    </Tag>
  );
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Absolutely positioned image filling its Figma slot. */
export function Img({
  src,
  rect,
  style,
  alt = '',
  className,
}: {
  src: string;
  rect: Rect;
  style?: CSSProperties;
  alt?: string;
  className?: string;
}) {
  return (
    <div className={className ? `abs ${className}` : 'abs'} style={{ ...rect, ...style }}>
      <img className="img-cover" src={src} alt={alt} draggable={false} />
    </div>
  );
}

/**
 * A Figma pill button. `labelTop` is the label's top inside the button (Figma: text top − button top);
 * `labelCx` is the label centre relative to the button's left edge.
 */
export function Pill({
  rect,
  variant,
  label,
  labelTop = 8,
  labelCx,
  onClick,
  disabled,
  type = 'button',
  children,
  ariaLabel,
  progress,
}: {
  rect: Rect;
  variant: 'black' | 'red' | 'outline';
  label: ReactNode;
  labelTop?: number;
  labelCx?: number;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  children?: ReactNode;
  ariaLabel?: string;
  progress?: number;
}) {
  const border = variant === 'outline' ? 2 : 0;
  const cx = (labelCx ?? rect.width / 2) - border;
  return (
    <button
      type={type}
      className={`pill pill-${variant}`}
      style={rect}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-busy={progress !== undefined || undefined}
    >
      {progress !== undefined && <span className="progress" style={{ width: `${Math.round(progress * 100)}%` }} />}
      <span className="label" style={{ top: labelTop - border, left: cx - 136, right: 'auto', width: 272, textAlign: 'center' }}>
        {label}
      </span>
      {children}
    </button>
  );
}
