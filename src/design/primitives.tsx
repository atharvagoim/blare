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

/** A pill button. The label is centred in the button, so every button's text lines up the same way. */
export function Pill({
  rect,
  variant,
  label,
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
      <span className="label">{label}</span>
      {children}
    </button>
  );
}
