import React, { useEffect, useRef, useCallback } from 'react';

interface NeuralNetworkBackgroundProps {
  messageCount: number;
  isProcessing: boolean;
  activeTab: string;
  /** 'low' = 38 nodes (recommended for 8GB), 'medium' = 56, 'high' = 72 */
  density?: 'low' | 'medium' | 'high';
  /** Override the default orange accent. Takes priority over TAB_PALETTE. */
  baseColor?: string;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pulsePhase: number;
  layer: number;
  id: number;
}

interface Connection {
  from: number;
  to: number;
  strength: number;
  active: boolean;
  pulseOffset: number;
}

const DENSITY_MAP: Record<string, number[]> = {
  low:    [6, 8, 10, 8, 6],   // 38 nodes
  medium: [8, 12, 16, 12, 8], // 56 nodes
  high:   [10, 16, 20, 16, 10] // 72 nodes
};

const TAB_PALETTE: Record<string, { primary: string; accent: string }> = {
  forgemind:    { primary: '#06b6d4', accent: '#22d3ee' }, // cyan + electric blue
  repoagent:    { primary: '#22c55e', accent: '#10b981' }, // greens
  orchestrator: { primary: '#a855f7', accent: '#c084fc' }, // purples
  failures:     { primary: '#ef4444', accent: '#f87171' }, // reds
  default:      { primary: '#06b6d4', accent: '#22d3ee' }
};

export const NeuralNetworkBackground: React.FC<NeuralNetworkBackgroundProps> = ({
  messageCount,
  isProcessing,
  activeTab,
  density = 'medium',
  baseColor
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Map<number, Node>>(new Map());
  const connectionsRef = useRef<Connection[]>([]);
  const animationRef = useRef<number>(0);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const lastMessageCountRef = useRef(messageCount);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const dprRef = useRef(1);
  const isVisibleRef = useRef(true);
  const rafPendingRef = useRef(false);

  const palette = TAB_PALETTE[activeTab] || TAB_PALETTE.default;
  // baseColor takes priority over tab palette
  const primaryColor = baseColor || palette.primary;

  const initNetwork = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    
    // Reset transform before scaling to prevent compounding
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    const nodes = new Map<number, Node>();
    const connections: Connection[] = [];
    
    const layers = 5;
    const nodesPerLayer = DENSITY_MAP[density] || DENSITY_MAP.medium;
    const width = rect.width;
    const height = rect.height;
    
    let nodeId = 0;
    for (let layer = 0; layer < layers; layer++) {
      const count = nodesPerLayer[layer];
      const layerX = (width / (layers + 1)) * (layer + 1);
      
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + (layer * Math.PI / 4);
        const radius = Math.min(width, height) * 0.15;
        const y = height / 2 + Math.sin(angle) * radius * (0.5 + Math.random() * 0.5);
        
        nodes.set(nodeId, {
          x: layerX + (Math.random() - 0.5) * 50,
          y: y,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          radius: 3 + Math.random() * 4,
          pulsePhase: Math.random() * Math.PI * 2,
          layer: layer,
          id: nodeId
        });
        nodeId++;
      }
    }
    
    // Create connections between adjacent layers
    for (let layer = 0; layer < layers - 1; layer++) {
      const currentLayerNodes = Array.from(nodes.values()).filter(n => n.layer === layer);
      const nextLayerNodes = Array.from(nodes.values()).filter(n => n.layer === layer + 1);
      
      currentLayerNodes.forEach(fromNode => {
        nextLayerNodes.forEach(toNode => {
          if (Math.random() > 0.3) {
            connections.push({
              from: fromNode.id,
              to: toNode.id,
              strength: Math.random(),
              active: false,
              pulseOffset: Math.random() * Math.PI * 2
            });
          }
        });
      });
    }
    
    nodesRef.current = nodes;
    connectionsRef.current = connections;
  }, [density]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const resize = () => initNetwork();
    
    resize();
    window.addEventListener('resize', resize);
    
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
      timeoutsRef.current.forEach(t => clearTimeout(t));
      timeoutsRef.current.clear();
    };
  }, [initNetwork]);

  // React to new messages
  useEffect(() => {
    if (messageCount > lastMessageCountRef.current) {
      const connections = connectionsRef.current;
      const shuffled = [...connections].sort(() => Math.random() - 0.5);
      const randomConnections = shuffled.slice(0, 5);
      
      randomConnections.forEach(conn => {
        conn.active = true;
        const t = setTimeout(() => {
          conn.active = false;
          timeoutsRef.current.delete(t);
        }, 1000);
        timeoutsRef.current.add(t);
      });
      
      lastMessageCountRef.current = messageCount;
    }
  }, [messageCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { 
        x: e.clientX - rect.left, 
        y: e.clientY - rect.top 
      };
    };
    
    const handleMouseLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };

    // Page Visibility API — pause RAF when tab hidden
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      isVisibleRef.current = isVisible;
      if (isVisible && !rafPendingRef.current) {
        rafPendingRef.current = true;
        animationRef.current = requestAnimationFrame(animate);
      } else if (!isVisible) {
        cancelAnimationFrame(animationRef.current);
        rafPendingRef.current = false;
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const MAX_VELOCITY = 3;
    const MOUSE_RADIUS = 150;
    const MOUSE_FORCE = 0.5;

    // Pre-calculate RGB from hex (moved outside hot loop)
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 249, g: 115, b: 22 };
    };
    const rgb = hexToRgb(primaryColor);
    const accentRgb = hexToRgb(palette.accent);

    const drawStatic = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      
      ctx.clearRect(0, 0, width, height);
      
      // Background with current palette
      const gradient = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.max(width, height) / 2
      );
      gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05)`);
      gradient.addColorStop(1, 'rgba(10, 10, 10, 0.95)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      
      // Draw nodes in fixed positions (no animation)
      const nodes = nodesRef.current;
      nodes.forEach(node => {
        const radius = node.radius;
        
        // Glow
        const glowGradient = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, radius * 3
        );
        glowGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`);
        glowGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * 3, 0, Math.PI * 2);
        ctx.fillStyle = glowGradient;
        ctx.fill();
        
        // Core
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = primaryColor;
        ctx.fill();
      });
      
      // Draw connections at rest strength
      const connections = connectionsRef.current;
      connections.forEach(conn => {
        const fromNode = nodes.get(conn.from);
        const toNode = nodes.get(conn.to);
        if (!fromNode || !toNode) return;
        
        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      });
    };

    const animate = () => {
      // Skip frame if tab hidden
      if (!isVisibleRef.current) {
        rafPendingRef.current = false;
        return;
      }
      
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      
      ctx.clearRect(0, 0, width, height);
      
      // Draw background gradient
      const gradient = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.max(width, height) / 2
      );
      gradient.addColorStop(0, 'rgba(15, 15, 15, 0.3)');
      gradient.addColorStop(1, 'rgba(10, 10, 10, 0.8)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      
      const nodes = nodesRef.current;
      const connections = connectionsRef.current;
      const time = Date.now() * 0.001;
      
      // Update and draw connections
      connections.forEach(conn => {
        const fromNode = nodes.get(conn.from);
        const toNode = nodes.get(conn.to);
        if (!fromNode || !toNode) return;
        
        if (isProcessing || conn.active) {
          conn.strength = Math.min(1, conn.strength + 0.02);
        } else {
          conn.strength = Math.max(0.1, conn.strength - 0.01);
        }
        
        const alpha = conn.strength * (0.35 + Math.sin(time * 2 + conn.pulseOffset) * 0.15);
        
        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        ctx.lineWidth = conn.strength * 1.5;
        ctx.stroke();
        
        if (conn.active || (isProcessing && conn.strength > 0.5)) {
          const progress = (time * 2 + conn.pulseOffset) % 1;
          const pulseX = fromNode.x + (toNode.x - fromNode.x) * progress;
          const pulseY = fromNode.y + (toNode.y - fromNode.y) * progress;
          
          ctx.beginPath();
          ctx.arc(pulseX, pulseY, 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.8 * conn.strength})`;
          ctx.fill();
        }
      });
      
      // Update and draw nodes
      nodes.forEach(node => {
        node.x += node.vx;
        node.y += node.vy;
        
        // Boundary check with bounce
        if (node.x < 50) { node.x = 50; node.vx *= -0.8; }
        if (node.x > width - 50) { node.x = width - 50; node.vx *= -0.8; }
        if (node.y < 50) { node.y = 50; node.vy *= -0.8; }
        if (node.y > height - 50) { node.y = height - 50; node.vy *= -0.8; }
        
        // Mouse interaction — guard against exact-zero only
        const dx = mouseRef.current.x - node.x;
        const dy = mouseRef.current.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_RADIUS && dist > 0) {
          const force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS;
          node.vx -= (dx / dist) * force * MOUSE_FORCE;
          node.vy -= (dy / dist) * force * MOUSE_FORCE;
        }
        
        // Velocity cap
        const velocity = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
        if (velocity > MAX_VELOCITY) {
          node.vx = (node.vx / velocity) * MAX_VELOCITY;
          node.vy = (node.vy / velocity) * MAX_VELOCITY;
        }
        
        // Damping
        node.vx *= 0.99;
        node.vy *= 0.99;
        
        // Pulse animation
        const pulse = Math.sin(time * 3 + node.pulsePhase) * 0.3 + 1;
        const radius = node.radius * pulse * (isProcessing ? 1.2 : 1);
        
        // Glow effect
        const glowRadius = radius * 3;
        const glowGradient = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, glowRadius
        );
        
        const alpha = isProcessing ? 0.8 : 0.5;
        glowGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`);
        glowGradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.5})`);
        glowGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = glowGradient;
        ctx.fill();
        
        // Core
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = primaryColor;
        ctx.fill();
        
        // Highlight
        ctx.beginPath();
        ctx.arc(node.x - radius * 0.3, node.y - radius * 0.3, radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fill();
      });
      
      // Tab-specific accent particles
      if (activeTab === 'forgemind' || activeTab === 'orchestrator') {
        nodes.forEach(node => {
          if (node.layer === 2 && Math.random() > 0.98) {
            ctx.beginPath();
            ctx.arc(node.x, node.y - 30, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.6)`;
            ctx.fill();
          }
        });
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    // Check reduced-motion preference — subscribe to changes mid-session
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let isRunning = !motionQuery.matches;

    const handleMotionChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        // User turned ON reduced motion — stop loop
        cancelAnimationFrame(animationRef.current);
        rafPendingRef.current = false;
        isRunning = false;
        // Static render with current palette
        drawStatic();
      } else {
        // User turned OFF reduced motion — start loop
        if (!rafPendingRef.current) {
          rafPendingRef.current = true;
          isRunning = true;
          animationRef.current = requestAnimationFrame(animate);
        }
      }
    };

    motionQuery.addEventListener('change', handleMotionChange);

    // Initial state
    if (isRunning) {
      rafPendingRef.current = true;
      animationRef.current = requestAnimationFrame(animate);
    } else {
      drawStatic();
    }
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      motionQuery.removeEventListener('change', handleMotionChange);
      cancelAnimationFrame(animationRef.current);
      timeoutsRef.current.forEach(t => clearTimeout(t));
      timeoutsRef.current.clear();
    };
  }, [isProcessing, activeTab, primaryColor, palette.accent]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
};

export default NeuralNetworkBackground;
