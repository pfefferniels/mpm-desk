import { Check, Edit, Delete } from "@mui/icons-material"
import { TextField, IconButton } from "@mui/material"
import { useState, useEffect } from "react"
import { useMode } from "../hooks/ModeProvider"

interface MetadataFieldDisplayProps<T extends { text: string }> {
    label: string
    field: T
    onChange: (field: T) => void
    onRemove: () => void
    multiline?: boolean
}

export const MetadataFieldDisplay = <T extends { text: string }>({
    label,
    field,
    onChange,
    onRemove,
    multiline
}: MetadataFieldDisplayProps<T>) => {
    const { isEditorMode } = useMode();
    const [editing, setEditing] = useState(false)
    const [text, setText] = useState(field.text)

    useEffect(() => setText(field.text), [field])

    if (!isEditorMode) {
        return (
            <div>
                <span>{field.text}</span>
                <span style={{ marginLeft: 8, color: 'gray', fontSize: '0.8em' }}>({label})</span>
            </div>
        )
    }

    return (
        <div>
            <TextField
                label={label}
                size='small'
                variant='outlined'
                value={text}
                onChange={e => setText(e.target.value)}
                disabled={!editing}
                multiline={multiline}
            />

            {editing ? (
                <IconButton onClick={() => {
                    onChange({
                        ...field,
                        text
                    })

                    setEditing(false)
                }}>
                    <Check />
                </IconButton>
            ) : (
                <IconButton onClick={() => setEditing(prev => !prev)}>
                    <Edit />
                </IconButton>
            )
            }

            <IconButton onClick={onRemove}>
                <Delete />
            </IconButton>
        </div >
    )
}