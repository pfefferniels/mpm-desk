import { Edit } from "@mui/icons-material";
import { ListItemButton, ListItemText, IconButton } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { ArgumentationDialog } from "./ArgumentationDialog";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Argumentation } from "doubtful/inverse";

interface ArgumentationCardProps {
    argumentation: Argumentation;
    onChange: (argumentation: Argumentation) => void;
    mergeInto: (transformerId: string, argumentation: Argumentation) => void;
}

export const ArgumentationCard = ({ argumentation, onChange, mergeInto }: ArgumentationCardProps) => {
    const [edit, setEdit] = useState<Argumentation | null>(null);
    const [dragTarget, setDragTarget] = useState(false)
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return

        dropTargetForElements({
            element: ref.current,
            canDrop({ source }) {
                return source.data.type === 'transformer'
            },
            onDrop(data) {
                const { source } = data;
                console.log('data=', data);
                mergeInto(source.data.transformerId as string, argumentation)
                setDragTarget(false)
            },
            onDragEnter() {
                setDragTarget(true)
            },
            onDragLeave() {
                setDragTarget(false)
            },
        })
    })

    return (
        <>
            <ListItemButton ref={ref} style={{
                border: dragTarget ? '1.5px dashed black' : 'inherit',
                borderRadius: 4,
            }}>
                <ListItemText
                    primary={argumentation.conclusion.that.assigned || ''}
                    secondary={<div>
                        {argumentation.note}
                        <br />{argumentation.id}
                    </div>} />

                <IconButton
                    onClick={(e) => {
                        e.stopPropagation();
                        setEdit(argumentation)
                    }}
                >
                    <Edit />
                </IconButton>
            </ListItemButton>

            {edit && (
                <ArgumentationDialog
                    open={edit !== null}
                    onClose={() => setEdit(null)}
                    onChange={() => {
                        onChange(edit);
                        setEdit(null);
                    }}
                    argumentation={edit}
                />
            )}
        </>
    )
}
