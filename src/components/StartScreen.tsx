import React, { useRef } from 'react';
import { Button, Divider, Stack } from '@mui/material';
import { FolderOpen, NoteAdd } from '@mui/icons-material';

interface StartScreenProps {
    onOpenZip: (file: File) => void;
    onOpenMei: (file: File) => void;
}

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
