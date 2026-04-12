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
      className={className}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: '20px',
        marginBottom: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      {(title || subtitle) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 14,
          }}
        >
          {title && (
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#202124', margin: 0 }}>
              {title}
            </h2>
          )}
          {subtitle && (
            <span style={{ fontSize: 12, color: '#5f6368' }}>{subtitle}</span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
