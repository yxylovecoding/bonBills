import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export default function Card({ title, subtitle, children, className = '' }: CardProps) {
  return (
    <section
      className={`bg-cardDark rounded-2xl p-4 mb-3 shadow-lg shadow-black/20 ${className}`}
    >
      {(title || subtitle) && (
        <header className="mb-3 flex items-baseline justify-between">
          {title && <h2 className="text-sm font-medium text-white/90">{title}</h2>}
          {subtitle && <span className="text-xs text-white/40">{subtitle}</span>}
        </header>
      )}
      {children}
    </section>
  );
}
