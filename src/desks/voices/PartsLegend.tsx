import { useState } from 'react';
import { Box, InputBase, Typography } from '@mui/material';
import { colorForPart } from './partColors';
import type { LegendPart } from './legendParts';

interface PartsLegendProps {
    parts: readonly LegendPart[];
    selected: ReadonlySet<number>;
    /** The voice picked out of a part, so it can be sent somewhere else on its own. */
    selectedVoice: string | undefined;
    onSelect: (part: number, additive: boolean) => void;
    onSelectVoice: (key: string | undefined) => void;
    onRename: (part: number, name: string) => void;
    onIsolate: (part: number | undefined) => void;
}

/**
 * What the colours mean, and where a part is named.
 *
 * The authority on the mapping rather than a key to it: hue alone is not accessible — six
 * categorical hues cannot all be pairwise safe under deuteranopia — so each row states its voices
 * in words, and hovering one dims every other part in the score.
 */
export const PartsLegend = ({
    parts,
    selected,
    selectedVoice,
    onSelect,
    onSelectVoice,
    onRename,
    onIsolate,
}: PartsLegendProps) => (
    <Box
        sx={{
            width: 232,
            flexShrink: 0,
            // The aspect menu is `position: absolute` over the desk at the right edge, so a panel
            // that ended at the window would sit under it. `MetadataDesk` carries the same gutter
            // and for the same reason.
            mr: '15rem',
            borderLeft: '1px solid #e5e7eb',
            bgcolor: '#ffffff',
            overflowY: 'auto',
        }}
        onMouseLeave={() => {
            onIsolate(undefined);
        }}
    >
        <Typography variant="subtitle2" sx={{ px: 1.5, py: 1, fontWeight: 'bold' }}>
            Parts
        </Typography>

        {parts.map((part) => (
            <PartRow
                key={part.number}
                part={part}
                selected={selected.has(part.number)}
                selectedVoice={selectedVoice}
                onSelect={onSelect}
                onSelectVoice={onSelectVoice}
                onRename={onRename}
                onIsolate={onIsolate}
            />
        ))}
    </Box>
);

interface PartRowProps {
    part: LegendPart;
    selected: boolean;
    selectedVoice: string | undefined;
    onSelect: (part: number, additive: boolean) => void;
    onSelectVoice: (key: string | undefined) => void;
    onRename: (part: number, name: string) => void;
    onIsolate: (part: number | undefined) => void;
}

const PartRow = ({
    part,
    selected,
    selectedVoice,
    onSelect,
    onSelectVoice,
    onRename,
    onIsolate,
}: PartRowProps) => {
    // The field is uncontrolled between commits, so typing does not dispatch. It commits on blur
    // and on Enter, and the reducer answers an unchanged layout by reference — which is what keeps
    // tabbing through the names from filling the undo stack with steps that undo nothing.
    const [draft, setDraft] = useState<string | null>(null);
    const value = draft ?? part.name;

    const commit = () => {
        setDraft(null);
        if (draft !== null && draft !== part.name) onRename(part.number, draft);
    };

    return (
        <Box
            onMouseEnter={() => {
                onIsolate(part.number);
            }}
            onClick={(event) => {
                onSelect(part.number, event.metaKey || event.ctrlKey);
            }}
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.75,
                cursor: 'pointer',
                bgcolor: selected ? '#f3f4f6' : 'transparent',
                boxShadow: selected ? 'inset 3px 0 0 #111827' : 'none',
                '&:hover': { bgcolor: '#f3f4f6' },
            }}
        >
            <Box
                sx={{
                    width: 12,
                    height: 12,
                    flexShrink: 0,
                    borderRadius: '2px',
                    bgcolor: colorForPart(part.number),
                }}
            />
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <InputBase
                    value={value}
                    placeholder={`Part ${String(part.number)}`}
                    onChange={(event) => {
                        setDraft(event.target.value);
                    }}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') setDraft(null);
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                    }}
                    inputProps={{ 'aria-label': `Name of part ${String(part.number)}` }}
                    sx={{ fontSize: '0.875rem', width: '100%' }}
                />
                {/* The voices, each one selectable on its own — which is how a part is taken
                    apart. Combine only ever folds parts together, so without this the melody of a
                    two-staff score could never be separated from the accompaniment under it. */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                    {part.voices.length === 0 && (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            no voice
                        </Typography>
                    )}
                    {part.voices.map((voice) => (
                        <Box
                            key={voice.key}
                            component="button"
                            aria-label={`Voice ${voice.key}`}
                            aria-pressed={selectedVoice === voice.key}
                            onClick={(event: React.MouseEvent) => {
                                event.stopPropagation();
                                onSelectVoice(selectedVoice === voice.key ? undefined : voice.key);
                            }}
                            sx={{
                                font: 'inherit',
                                fontSize: '0.72rem',
                                cursor: 'pointer',
                                px: 0.6,
                                py: 0.1,
                                borderRadius: '3px',
                                border: '1px solid',
                                borderColor: selectedVoice === voice.key ? '#111827' : '#e5e7eb',
                                bgcolor: selectedVoice === voice.key ? '#111827' : '#ffffff',
                                color: selectedVoice === voice.key ? '#ffffff' : 'text.secondary',
                            }}
                        >
                            {`S${voice.staff}/L${voice.layer}`}
                        </Box>
                    ))}
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {`${String(part.notes)} notes`}
                    </Typography>
                </Box>
            </Box>
        </Box>
    );
};
