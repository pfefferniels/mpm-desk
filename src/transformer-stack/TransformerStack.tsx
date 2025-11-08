import { Card, Stack } from "@mui/material";
import { Transformer } from "mpmify/lib/transformers/Transformer";
import { useCallback, useState } from "react";
import {
    IconButton,
} from "@mui/material";
import { Clear, DeleteForever, RestartAlt } from "@mui/icons-material";
import { isDateBased, isNoteBased, isRangeBased, TransformerListItem } from "./TransformerListItem";
import { ArgumentationCard } from "./ArgumentationCard";
import { Argumentation } from "doubtful/inverse";
import { DropTarget } from "./DropTarget";
import { v4 } from "uuid";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { layoutIntervals } from "./interval";

interface TransformerStackProps {
    transformers: Transformer[];
    setTransformers: (transformers: Transformer[]) => void;

    onRemove: (transformer: Transformer) => void;
    onSelect: (transformer?: Transformer) => void;
    onReset: () => void;
    activeTransformer?: Transformer;
}

export const TransformerStack = ({ transformers, setTransformers, onRemove, onSelect, onReset, activeTransformer }: TransformerStackProps) => {
    const [isDragging, setIsDragging] = useState(false);

    const stretchX = useSymbolicZoom()

    const argumentations = Map.groupBy(transformers, t => t.argumentation)
    const intervals = Array
        .from(argumentations)
        .map(([argumentation, localTransformers]) => {
            const startDates = localTransformers
                .map(t => {
                    if (isRangeBased(t.options)) {
                        return t.options.from
                    }
                    else if (isDateBased(t.options)) {
                        return t.options.date
                    }
                    else if (isNoteBased(t.options)) {
                        // TODO
                    }
                })
                .filter(d => d !== undefined)

            const endDates = localTransformers
                .map(t => {
                    if (isRangeBased(t.options)) {
                        return t.options.to
                    }
                    else if (isDateBased(t.options)) {
                        return t.options.date
                    }
                    else if (isNoteBased(t.options)) {
                        // TODO
                    }
                })
                .filter(d => d !== undefined)

            if (startDates.length === 0 || endDates.length === 0) {
                return null;
            }

            const start = Math.min(...startDates) * stretchX;
            const end = Math.max(...endDates) * stretchX;

            return {
                start, end, argumentation, localTransformers
            }
        })
        .filter(i => i !== null)

    const layout = layoutIntervals(intervals)

    const mergeInto = useCallback((transformerId: string, argumentation: Argumentation) => {
        const transformer = transformers.find(t => t.id === transformerId);
        if (!transformer) return;
        transformer.argumentation = argumentation;
        setTransformers([...transformers]);
    }, [transformers, setTransformers]);

    const options = transformers
        .map(t => t.options)

    const dates = options
        .filter(isRangeBased)
        .map(({ to }) => to)
        .concat(
            ...options
                .filter(isDateBased)
                .map(({ date }) => date)
        )
    const maxDate = dates.length > 0 ? Math.max(...dates) : 100;

    return (
        <Card style={{ overflow: 'scroll', position: 'relative', height: '300px', width: '100vw', borderTop: '0.5px solid gray' }}>
            <Stack direction="row">
                {transformers.length > 0 && (
                    <>
                        <IconButton
                            onClick={onReset}
                        >
                            <RestartAlt />
                        </IconButton>
                        <IconButton onClick={() => setTransformers([])}>
                            <DeleteForever />
                        </IconButton>
                    </>
                )}
                {activeTransformer && (
                    <IconButton onClick={() => onSelect(undefined)}>
                        <Clear />
                    </IconButton>
                )}
            </Stack>

            <div style={{ width: maxDate * stretchX + 100 }}>
                <DropTarget onAdd={(transformerId) => {
                    const transformer = transformers.find(t => t.id === transformerId)
                    if (!transformer) return

                    transformer.argumentation = {
                        type: 'simpleArgumentation',
                        id: `arg_${v4()}`,
                        conclusion: {
                            id: 'concl_' + v4(),
                            that: {
                                id: 'that_' + v4(),
                                subject: '',
                                type: 'assigned',
                                assigned: '',
                            },
                            type: 'belief',
                            certainty: 'possible'
                        },
                    }

                    setTransformers([
                        ...transformers,
                    ])
                }} />

                {layout
                    .map(({ argumentation, localTransformers, track }) => {
                        const startDates = localTransformers
                            .map(t => {
                                if (isRangeBased(t.options)) {
                                    return t.options.from
                                }
                                else if (isDateBased(t.options)) {
                                    return t.options.date
                                }
                                else if (isNoteBased(t.options)) {
                                    // TODO
                                }
                            })
                            .filter(d => d !== undefined)

                        const endDates = localTransformers
                            .map(t => {
                                if (isRangeBased(t.options)) {
                                    return t.options.to
                                }
                                else if (isDateBased(t.options)) {
                                    return t.options.date
                                }
                                else if (isNoteBased(t.options)) {
                                    // TODO
                                }
                            })
                            .filter(d => d !== undefined)

                        if (startDates.length === 0 || endDates.length === 0) {
                            return null;
                        }

                        const start = Math.min(...startDates) * stretchX;
                        const end = Math.max(...endDates) * stretchX;

                        return (
                            <div style={{
                                position: 'absolute',
                                left: start,
                                bottom: track * 72,
                                width: end - start,
                                maxWidth: end - start,
                                minHeight: '1rem',
                            }}>
                                <ArgumentationCard
                                    argumentation={argumentation}
                                    onChange={() => {
                                        // todo
                                    }}
                                    mergeInto={mergeInto}
                                    isDragging={isDragging}
                                >
                                    {localTransformers.map((transformer) => {
                                        const index = transformers.indexOf(transformer);

                                        return (
                                            <TransformerListItem
                                                key={`transformer_${index}`}
                                                transformer={transformer}
                                                index={index}
                                                onSelect={() => onSelect(transformer)}
                                                onRemove={() => onRemove(transformer)}
                                                onEdit={(options) => {
                                                    transformer.options = options;
                                                    setTransformers([...transformers]);
                                                }}
                                                onStateChange={(state) => {
                                                    console.log('state change', state)
                                                    setIsDragging(state.type === 'is-dragging')
                                                }}
                                                selected={activeTransformer?.id === transformer.id}
                                            />
                                        )
                                    })}
                                </ArgumentationCard>
                            </div>
                        )
                    })}
            </div>
        </Card>
    );
}; 