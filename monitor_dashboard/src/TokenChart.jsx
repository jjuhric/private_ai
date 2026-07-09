import React from 'react';

export default function TokenChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ display: 'flex', height: '240px', alignItems: 'center', justifyContent: 'center', width: '100%', color: 'var(--text-secondary)' }}>
        No data to display in chart.
      </div>
    );
  }

  const padding = 45;
  const width = 600;
  const height = 260;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const maxValue = Math.max(...data.map(d => d.value), 100);

  // Generate coordinates for SVG path
  const points = data.map((d, index) => {
    const x = padding + (index / (data.length - 1 || 1)) * chartWidth;
    const y = padding + chartHeight - (d.value / maxValue) * chartHeight;
    return { x, y, label: d.label, value: d.value };
  });

  const pathD = points.reduce((acc, p, index) => {
    return index === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, '');

  const areaD = points.length > 0 
    ? `${pathD} L ${points[points.length - 1].x} ${padding + chartHeight} L ${points[0].x} ${padding + chartHeight} Z`
    : '';

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        
        {/* Y Axis Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
          const y = padding + chartHeight - ratio * chartHeight;
          const labelVal = Math.round(ratio * maxValue);
          return (
            <g key={idx}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
              <text x={padding - 10} y={y + 4} textAnchor="end" fill="var(--text-secondary)" style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                {labelVal >= 1000 ? `${(labelVal / 1000).toFixed(1)}k` : labelVal}
              </text>
            </g>
          );
        })}

        {/* X Axis Labels */}
        {points.map((p, idx) => (
          <text key={idx} x={p.x} y={height - padding + 22} textAnchor="middle" fill="var(--text-secondary)" style={{ fontSize: '10px' }}>
            {p.label}
          </text>
        ))}

        {/* Area Fill */}
        {areaD && <path d={areaD} fill="url(#chartGradient)" />}

        {/* Line Path */}
        {pathD && <path d={pathD} fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}

        {/* Dots and Tooltips */}
        {points.map((p, idx) => (
          <g key={idx} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r="4" fill="var(--accent-secondary)" stroke="#0b0f19" strokeWidth="2" />
            <circle cx={p.x} cy={p.y} r="12" fill="transparent" />
            <title>{`${p.value.toLocaleString()} tokens\n${p.label}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}
