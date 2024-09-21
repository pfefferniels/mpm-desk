import { Check, Edit, Delete } from "@mui/icons-material"
import { TextField, IconButton } from "@mui/material"
import { useState, useEffect } from "react"
import { Author } from "../../../mpm-ts/lib"

interface AuthorDisplayProps {
    author: Author
    onChange: (author: Author) => void
    onRemove: () => void
}

export const AuthorDisplay = ({ author, onChange, onRemove }: AuthorDisplayProps) => {
    const [editMode, setEditMode] = useState(false)
    const [text, setText] = useState(author.text)

    useEffect(() => setText(author.text), [author])

    return (
        <div>
            <TextField
                label='Author'
                size='small'
                variant='outlined'
                value={text}
                onChange={e => setText(e.target.value)}
                disabled={!editMode}
            />

            {editMode ? (
                <IconButton onClick={() => {
                    onChange({
                        ...author,
                        text
                    })

                    setEditMode(false)
                }}>
                    <Check />
                </IconButton>
            ) : (
                <IconButton onClick={() => setEditMode(prev => !prev)}>
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