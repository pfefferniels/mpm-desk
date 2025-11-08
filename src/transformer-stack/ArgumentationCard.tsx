import { Card } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { ArgumentationDialog } from "./ArgumentationDialog";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Argumentation } from "doubtful/inverse";

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
                console.log('drop target card')
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
                style={{
                    border: `${dragTarget ? '1.5px dashed' : '0.2px solid'} gray`,
                    borderRadius: '10px',
                    fontSize: 12,
                    position: 'relative',
                    paddingLeft: '0.2rem'
                }}
                onClick={(e) => {
                    e.stopPropagation()
                    setEdit(argumentation)
                }}
            >
                <div>
                    {argumentation.conclusion.that.assigned || ''}
                </div>

                <div>
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
