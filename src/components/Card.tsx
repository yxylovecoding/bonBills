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
      className={`bg-white rounded-2xl p-5 mb-3 shadow-card ${className}`}
    >
      {(title || subtitle) && (
        <header className="mb-3 flex items-baseline justify-between">
          {title && <h2 className="text-sm font-semibold text-gtext">{title}</h2>}
          {subtitle && <span className="text-xs text-gsub">{subtitle}</span>}
        </header>
      )}
      {children}
    </section>
  );
}
