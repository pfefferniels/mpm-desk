import React, { useRef } from 'react';
import { Button, Divider, Stack, Typography } from '@mui/material';
import { FolderOpen, NoteAdd } from '@mui/icons-material';

interface StartScreenProps {
    onOpenZip: (file: File) => void;
    onOpenMei: (file: File) => void;
}

/**
 * The two ways in, and what happens after the second.
 *
 * A project is a score and what was played of it, but the recordings are not chosen here: a
 * recording of nothing is nothing, and until a score is open there is nothing to say a MIDI file
 * is a performance *of*. So an unaligned score opens on the alignment desk, and the takes are
 * added there, against the score they belong to.
 */
export const StartScreen: React.FC<StartScreenProps> = ({ onOpenZip, onOpenMei }) => {
    const zipInputRef = useRef<HTMLInputElement>(null);
    const meiInputRef = useRef<HTMLInputElement>(null);

    return (
        <Stack
            alignItems="center"
            justifyContent="center"
            sx={{ height: '100vh', bgcolor: 'background.default' }}
        >
            <Stack direction="row" alignItems="center" sx={{ height: 100 }}>
                <Button
                    size="large"
                    startIcon={<FolderOpen />}
                    onClick={() => zipInputRef.current?.click()}
                >
                    Open existing project
                </Button>

                <Divider orientation="vertical" flexItem sx={{ mx: 3 }}>
                    or
                </Divider>

                <Button
                    size="large"
                    startIcon={<NoteAdd />}
                    onClick={() => meiInputRef.current?.click()}
                >
                    New project
                </Button>
            </Stack>

            <input
                ref={zipInputRef}
                type="file"
                accept=".zip"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onOpenZip(file);
                    e.target.value = '';
                }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, maxWidth: '32rem', textAlign: 'center' }}>
                A new project starts from a score. A score nobody has aligned opens on the
                alignment desk, where you add the recordings it was played in and put the two note
                against note.
            </Typography>

            <input
                ref={meiInputRef}
                type="file"
                accept="application/xml,.mei"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onOpenMei(file);
                    e.target.value = '';
                }}
            />
        </Stack>
    );
};
