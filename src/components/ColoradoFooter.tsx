// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Permanent app footer: Colorado Rocky Mountain silhouette behind
// "Made In Colorado With Love". Pure inline SVG — no image assets,
// no dependencies. Rendered once at the app shell level, in normal
// document flow (not a floating overlay).

export default function ColoradoFooter() {
  return (
    <footer
      style={{
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        borderTop: '1px solid #1a1a1a',
        background: '#0a0a0a',
        userSelect: 'none',
      }}
      aria-label="Made In Colorado With Love"
    >
      {/* Mountain silhouette backdrop — scales to any width */}
      <svg
        viewBox="0 0 1200 140"
        preserveAspectRatio="xMidYMax slice"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        aria-hidden="true"
      >
        {/* Stars */}
        <g fill="#555" opacity="0.55">
          <circle cx="120" cy="22" r="1.4" />
          <circle cx="310" cy="14" r="1.1" />
          <circle cx="520" cy="26" r="1.3" />
          <circle cx="760" cy="12" r="1.1" />
          <circle cx="980" cy="24" r="1.4" />
          <circle cx="1120" cy="16" r="1.0" />
        </g>
        {/* Far range */}
        <polygon
          points="0,100 150,45 260,85 400,30 520,80 680,40 800,85 950,50 1080,85 1200,60 1200,140 0,140"
          fill="#232328"
        />
        {/* Snow caps on far peaks */}
        <g fill="#3d3d44" opacity="0.7">
          <polygon points="400,30 385,42 415,42" />
          <polygon points="680,40 666,52 694,52" />
          <polygon points="950,50 937,61 963,61" />
        </g>
        {/* Mid range */}
        <polygon
          points="0,112 100,70 220,102 350,55 480,96 620,65 750,102 880,70 1000,102 1120,75 1200,96 1200,140 0,140"
          fill="#17171b"
        />
        {/* Near range */}
        <polygon
          points="0,122 180,86 320,116 500,82 700,116 850,92 1050,122 1200,102 1200,140 0,140"
          fill="#101013"
        />
        {/* Pine trees along the near ridge */}
        <g fill="#0b0d0b">
          <polygon points="212,96 218,78 224,96" />
          <polygon points="228,98 234,80 240,98" />
          <polygon points="548,92 554,74 560,92" />
          <polygon points="564,94 570,76 576,94" />
          <polygon points="906,102 912,84 918,102" />
          <polygon points="922,104 928,86 934,104" />
          <polygon points="1062,110 1068,94 1074,110" />
        </g>
      </svg>

      {/* Text — sits above the artwork */}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '22px 16px 14px' }}>
        <div
          style={{
            color: '#e8dcc8',
            fontSize: '13px',
            letterSpacing: '3px',
            fontWeight: 600,
            textTransform: 'uppercase',
            textShadow: '0 1px 8px rgba(0,0,0,0.9)',
          }}
        >
          Made In Colorado With <span style={{ color: '#f97316' }}>Love</span>
        </div>
        <div
          style={{
            marginTop: '6px',
            color: '#3a3a3a',
            fontSize: '8px',
            letterSpacing: '1.5px',
          }}
        >
          FORGECLAW · AUTONOMOUS REASONING ENGINE · BUILT BY DEVIOUSDEVV303
        </div>
      </div>
    </footer>
  )
}
