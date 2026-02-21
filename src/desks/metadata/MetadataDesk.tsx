import { Card, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";

interface MetadataDeskProps {
    metadata: { author: string, title: string }
    setMetadata: React.Dispatch<React.SetStateAction<{ author: string, title: string }>>
    appBarRef: React.RefObject<HTMLDivElement | null> | null
    isEditorMode: boolean
}

export const MetadataDesk = ({ metadata, setMetadata, isEditorMode }: MetadataDeskProps) => {
    // Local state for responsive typing - only sync to App on blur
    const [localTitle, setLocalTitle] = useState(metadata.title)
    const [localAuthor, setLocalAuthor] = useState(metadata.author)

    if (!isEditorMode) {
        return (
            <Stack spacing={2} sx={{ margin: 4, maxWidth: '600px' }}>
                <Typography variant="h4" component="h1">
                    {metadata.title || 'Untitled'}
                </Typography>
                {metadata.author && (
                    <Typography variant="subtitle1" color="text.secondary">
                        {metadata.author}
                    </Typography>
                )}
            </Stack>
        )
    }

    return (
        <div>
            <Card elevation={7} sx={{ margin: 2, maxWidth: '400px' }}>
                <Stack direction='column' spacing={2} m={2}>
                    <TextField
                        label="Title"
                        value={localTitle}
                        onChange={(e) => setLocalTitle(e.target.value)}
                        onBlur={() => setMetadata(prev => ({ ...prev, title: localTitle }))}
                        fullWidth
                    />
                    <TextField
                        label="Author"
                        value={localAuthor}
                        onChange={(e) => setLocalAuthor(e.target.value)}
                        onBlur={() => setMetadata(prev => ({ ...prev, author: localAuthor }))}
                        fullWidth
                    />
                </Stack>
            </Card>
        </div>
    )
}
