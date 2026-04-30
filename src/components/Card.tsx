import { useState } from 'react';
import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export default function Card({ title, subtitle, children, className = '', collapsible = false, defaultCollapsed = false }: CardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const showHeader = !!(title || subtitle);
  const isCollapsed = collapsible && collapsed;
  return (
    <section
      className={className}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: '20px',
        marginBottom: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        overflow: 'hidden',
      }}
    >
      {showHeader && (
        <div
          onClick={collapsible ? () => setCollapsed((v) => !v) : undefined}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: isCollapsed ? 0 : 14,
            cursor: collapsible ? 'pointer' : 'default',
            userSelect: collapsible ? 'none' : 'auto',
          }}
        >
          {title && (
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#202124', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              {title}
              {collapsible && (
                <span style={{ fontSize: 11, color: '#5f6368', transform: isCollapsed ? 'none' : 'rotate(180deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▼</span>
              )}
            </h2>
          )}
          {subtitle && (
            <span style={{ fontSize: 12, color: '#5f6368' }}>{subtitle}</span>
          )}
        </div>
      )}
      {!isCollapsed && children}
    </section>
  );
}
