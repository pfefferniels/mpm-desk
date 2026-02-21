import { useCallback, useState } from 'react';
import { Box, IconButton, Slider, Tooltip, Typography } from '@mui/material';
import { ZoomIn, Download, PlayArrow, Stop } from '@mui/icons-material';
import { useZoom } from '../hooks/ZoomProvider';
import { usePlayback } from '../hooks/PlaybackProvider';

const glassStyle = {
    backdropFilter: 'blur(20px) saturate(180%)',
    background: 'rgba(255, 255, 255, 0.55)',
    boxShadow: '0 1px 12px rgba(0, 0, 0, 0.06), inset 0 0 0 0.5px rgba(255, 255, 255, 0.6)',
    borderRadius: '14px',
};

interface ExpandableRowProps {
    icon: React.ReactNode;
    tooltip: string;
    expanded: boolean;
    onExpandChange: (expanded: boolean) => void;
    onClick?: () => void;
    children: React.ReactNode;
}

const ExpandableRow = ({ icon, tooltip, expanded, onExpandChange, onClick, children }: ExpandableRowProps) => (
    <Box
        onMouseEnter={() => onExpandChange(true)}
        onMouseLeave={() => onExpandChange(false)}
        sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}
    >
        <Tooltip title={tooltip} placement="right">
            <IconButton onClick={onClick} size="small" sx={{ color: 'text.secondary' }}>
                {icon}
            </IconButton>
        </Tooltip>
        <Box sx={{
            position: 'absolute',
            left: '100%',
            top: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            pl: 2,
            pr: 1.5,
            ...glassStyle,
            width: expanded ? 156 : 0,
            opacity: expanded ? 1 : 0,
            overflow: 'hidden',
            transition: 'width 200ms ease, opacity 200ms ease',
            pointerEvents: expanded ? 'auto' : 'none',
        }}>
            {children}
        </Box>
    </Box>
);

interface ViewerToolbarProps {
    onDownload: () => void;
    metadata?: { title: string; author: string };
}

export const ViewerToolbar = ({ onDownload, metadata }: ViewerToolbarProps) => {
    const { stretchX, setStretchX } = useZoom();
    const { play, stop, isPlaying } = usePlayback();
    const [zoomHovered, setZoomHovered] = useState(false);
    const [exaggeration, setExaggeration] = useState(1.0);

    const handlePlayToggle = useCallback(() => {
        if (isPlaying) {
            stop();
        } else {
            play({ exaggerate: exaggeration });
        }
    }, [isPlaying, play, stop, exaggeration]);

    const handleExaggerationCommit = useCallback((_: unknown, value: number | number[]) => {
        const v = value as number;
        setExaggeration(v);
        if (isPlaying) {
            play({ exaggerate: v });
        }
    }, [isPlaying, play]);

    const hasMetadata = metadata?.title || metadata?.author;

    return (
        <Box sx={{
            position: 'fixed',
            top: 16,
            left: 16,
            zIndex: 20,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 2,
        }}>
            <Box sx={{
                ...glassStyle,
                display: 'flex',
                flexDirection: 'column',
                p: 0.5,
                flexShrink: 0,
            }}>
                <ExpandableRow
                    icon={<ZoomIn fontSize="small" />}
                    tooltip="Zoom"
                    expanded={zoomHovered}
                    onExpandChange={setZoomHovered}
                >
                    <Slider
                        size="small"
                        value={stretchX}
                        min={1}
                        max={60}
                        step={0.5}
                        onChange={(_, v) => setStretchX(v as number)}
                        onClick={e => e.stopPropagation()}
                    />
                </ExpandableRow>

                <Tooltip title="Download" placement="right">
                    <IconButton onClick={onDownload} size="small" sx={{ color: 'text.secondary' }}>
                        <Download fontSize="small" />
                    </IconButton>
                </Tooltip>

                <ExpandableRow
                    icon={isPlaying ? <Stop fontSize="small" /> : <PlayArrow fontSize="small" />}
                    tooltip={isPlaying ? 'Stop' : 'Play'}
                    expanded={isPlaying}
                    onExpandChange={() => {}}
                    onClick={handlePlayToggle}
                >
                    <Slider
                        size="small"
                        value={exaggeration}
                        min={1}
                        max={3}
                        step={0.1}
                        onChange={(_, v) => setExaggeration(v as number)}
                        onChangeCommitted={handleExaggerationCommit}
                    />
                </ExpandableRow>
            </Box>

            {hasMetadata && (
                <Box sx={{ pt: 0.5 }}>
                    {metadata!.title && (
                        <Typography sx={{
                            fontFamily: "'Georgia', 'Times New Roman', serif",
                            fontSize: '1.1rem',
                            fontWeight: 400,
                            color: 'text.secondary',
                            lineHeight: 1.3,
                        }}>
                            {metadata!.title}
                        </Typography>
                    )}
                    {metadata!.author && (
                        <Typography sx={{
                            fontFamily: "'Georgia', 'Times New Roman', serif",
                            fontSize: '0.85rem',
                            fontStyle: 'italic',
                            color: 'text.disabled',
                            mt: 0.25,
                        }}>
                            {metadata!.author}
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    );
};
