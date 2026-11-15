// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * ThroneBackdrop — purely presentational fixed backdrop behind the neural canvas.
 *
 * Renders the operator's throne image centered in the viewport, edges faded
 * into the app background via a radial mask, with a dark scrim on top to keep
 * light text above the 4.5:1 contrast threshold. Sits below the neural canvas
 * in DOM order (sibling before it). Never intercepts clicks. Does not affect
 * state, learning, phase logic, or palette.
 *
 * The image asset is optional: if `src/assets/throne-backdrop.webp` is not
 * present (e.g. pending operator approval — the repo is public and the image
 * contains the operator's likeness), the component renders nothing and the
 * app works normally. Drop the file in and the backdrop appears, no code
 * change needed.
 */
import React, { useState, useEffect } from 'react';

interface ThroneBackdropProps {
  /**
   * 0–1. Default 0.35 — keeps the throne visible while preserving text
   * contrast. Values above ~0.4 risk dropping light text below 4.5:1.
   */
  opacity?: number;
  /** Dark scrim opacity over the image. Default 0.45. */
  scrimOpacity?: number;
}

export const ThroneBackdrop: React.FC<ThroneBackdropProps> = ({
  opacity = 0.35,
  scrimOpacity = 0.45,
}) => {
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Dynamic import: resolves at build time if the asset exists,
    // rejects cleanly if it doesn't — no build failure either way.
    import('../assets/throne-backdrop.webp')
      .then((mod) => {
        if (!cancelled) setImgSrc(mod.default);
      })
      .catch(() => {
        // Asset missing — render nothing. This is expected until the
        // operator commits the image.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Silently render nothing until the asset exists.
  if (!imgSrc) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <img
        src={imgSrc}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
          opacity,
          // Fade edges into the app background — no hard rectangle borders
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          userSelect: 'none',
        }}
      />
      {/* Dark scrim for text contrast */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `rgba(5, 5, 8, ${scrimOpacity})`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

export default ThroneBackdrop;
