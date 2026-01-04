import { Card } from "@mui/material";
import { Argumentation, getRange, Transformer } from "mpmify/lib/transformers/Transformer";
import { useCallback, useState } from "react";
import { TransformerListItem } from "./TransformerListItem";
import { ArgumentationCard } from "./ArgumentationCard";
import { DropTarget } from "./DropTarget";
import { v4 } from "uuid";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { layoutIntervals } from "./interval";
import { MSM } from "mpmify";

interface TransformerStackProps {
    transformers: Transformer[];
    setTransformers: (transformers: Transformer[]) => void;
    msm: MSM;

    onRemove: (transformer: Transformer) => void;
    onSelect: (transformer?: Transformer) => void;

    activeTransformer?: Transformer;
}

export const TransformerStack = ({ transformers, setTransformers, msm, onRemove, onSelect, activeTransformer }: TransformerStackProps) => {
    const [isDragging, setIsDragging] = useState(false);

    const stretchX = useSymbolicZoom()

    const argumentations = Map.groupBy(transformers, t => t.argumentation)
    const intervals = Array
        .from(argumentations)
        .map(([argumentation, localTransformers]) => {
            const range = getRange(localTransformers, msm)
            if (!range) return null;

            return {
                start: range.from * stretchX, end: (range.to || range.from) * stretchX, argumentation, localTransformers
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

    const maxDate = (getRange(transformers, msm)?.to || 0) * stretchX;
    const maxTrack = Math.max(...layout.map(({ track }) => track))
    const trackHeight = 71

    if (transformers.length === 0) return null;

    return (
        <Card style={{
            overflow: 'scroll',
            position: 'relative',
            height: '300px',
            width: '100vw',
            borderTop: '0.5px solid gray'
        }}>
            <div style={{ position: 'relative', width: maxDate, height: maxTrack * trackHeight }}>
                <DropTarget
                    left={0}
                    bottom={0}
                    width={maxDate}
                    height={maxTrack * trackHeight}
                    onAdd={(transformerId) => {
                        const transformer = transformers.find(t => t.id === transformerId)
                        if (!transformer) return

                        transformer.argumentation = {
                            type: 'simpleArgumentation',
                            id: `arg_${v4()}`,
                            conclusion: {
                                id: 'concl_' + v4(),
                                certainty: 'plausible',
                                motivation: 'unknown',
                            },
                        }

                        setTransformers([
                            ...transformers,
                        ])
                    }}
                />

                {layout
                    .map(({ argumentation, localTransformers, track }) => {
                        const range = getRange(localTransformers, msm);

                        if (!range) {
                            console.log('no range for', localTransformers)
                            return null;
                        }

                        const start = range.from * stretchX;
                        const end = (range.to || range.from) * stretchX;

                        return (
                            <div
                                key={`argumentation_${argumentation.id}`}
                                style={{
                                position: 'absolute',
                                left: start,
                                bottom: track * trackHeight,
                                width: end - start,
                                minWidth: '4rem',
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