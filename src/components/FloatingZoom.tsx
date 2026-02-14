import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Slider } from '@mui/material';
import { ZoomIn } from '@mui/icons-material';
import { useZoom } from '../hooks/ZoomProvider';

export const FloatingZoom = () => {
    const { stretchX, setStretchX } = useZoom();
    const [isExpanded, setIsExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const recentTouchRef = useRef(false);

    const handleMouseEnter = useCallback(() => {
        if (recentTouchRef.current) return;
        setIsExpanded(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
        if (recentTouchRef.current) return;
        setIsExpanded(false);
    }, []);

    const handleTouchStart = useCallback(() => {
        recentTouchRef.current = true;
        setTimeout(() => { recentTouchRef.current = false; }, 300);
    }, []);

    const handleClick = useCallback(() => {
        if (!recentTouchRef.current) return;
        setIsExpanded(prev => !prev);
    }, []);

    // Click-outside collapse
    useEffect(() => {
        if (!isExpanded) return;

        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsExpanded(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isExpanded]);

    return (
        <Box
            ref={containerRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onClick={handleClick}
            sx={{
                position: 'fixed',
                bottom: 16,
                right: 16,
                zIndex: 20,
                width: isExpanded ? 220 : 48,
                height: 48,
                borderRadius: 24,
                backdropFilter: 'blur(17px)',
                background: 'rgba(255, 255, 255, 0.55)',
                boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
                transition: 'width 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
            }}
        >
            <ZoomIn sx={{ ml: 1.5, mr: 1, flexShrink: 0, color: 'text.secondary' }} />
            <Slider
                size="small"
                aria-label="Zoom"
                value={stretchX}
                min={1}
                max={60}
                step={0.5}
                onChange={(_, value) => setStretchX(value as number)}
                onClick={(e) => e.stopPropagation()}
                sx={{
                    mr: 2,
                    flexShrink: 1,
                    minWidth: 0,
                    opacity: isExpanded ? 1 : 0,
                    transition: 'opacity 200ms ease',
                }}
            />
        </Box>
    );
};
