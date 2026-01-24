import { Card } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { ArgumentationDialog } from "./ArgumentationDialog";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Argumentation } from "mpmify";

interface ArgumentationCardProps {
    argumentation: Argumentation;
    onChange: (argumentation: Argumentation) => void;
    mergeInto: (transformerId: string, argumentation: Argumentation) => void;
    isDragging: boolean
    children: React.ReactNode;
}

export const ArgumentationCard = ({ argumentation, onChange, mergeInto, children }: ArgumentationCardProps) => {
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
            <Card
                ref={ref}
                elevation={0}
                sx={{
                    border: `${dragTarget ? '1.5px dashed' : '1px solid'} lightgray`,
                    borderRadius: 1,
                    fontSize: 12,
                    position: 'relative',
                    paddingLeft: '0.2rem',
                    "&:hover": {
                        boxShadow: 6
                    },
                    backgroundColor: 'rgba(240,240,240,0.5)',
                }}
                onClick={(e) => {
                    e.stopPropagation()
                    setEdit(argumentation)
                }}
            >
                <div style={{ cursor: 'default' }}>
                    {argumentation.conclusion.motivation || ''}
                </div>

                <div onClick={(e) => e.stopPropagation()}>
                    {children}
                </div>
            </Card>

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
