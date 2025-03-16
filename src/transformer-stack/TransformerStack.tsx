import { Card, Collapse, Stack } from "@mui/material";
import { Transformer } from "mpmify/lib/transformers/Transformer";
import { useEffect, useState } from "react";
import {
    List,
    ListItem,
    ListItemText,
    IconButton,
} from "@mui/material";
import { Clear, ExpandLess, ExpandMore, RestartAlt, Save, UploadFile } from "@mui/icons-material";
import { downloadAsFile } from "../utils/utils";
import { ApproximateLogarithmicTempo, CombineAdjacentRubatos, InsertArticulation, InsertDynamicsGradient, InsertDynamicsInstructions, InsertMetricalAccentuation, InsertPedal, InsertRelativeDuration, InsertRelativeVolume, InsertRubato, InsertTemporalSpread, MergeMetricalAccentuations, StylizeArticulation, StylizeOrnamentation, TranslatePhyiscalTimeToTicks, validate } from "mpmify";
import { flushSync } from "react-dom";
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { reorderWithEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/reorder-with-edge';
import { triggerPostMoveFlash } from '@atlaskit/pragmatic-drag-and-drop-flourish/trigger-post-move-flash';
import { isTransformerData } from "./transformer-data";
import { TransformerListItem } from "./TransformerListItem";
import { useRef } from "react";
import { v4 } from "uuid";

interface TransformerStackProps {
    transformers: Transformer[];
    setTransformers: (transformers: Transformer[]) => void;
    onRemove: (transformer: Transformer) => void;
    onSelect: (transformer: Transformer) => void;
    onReset: () => void;
    activeTransformer?: Transformer;
}

export const TransformerStack = ({ transformers, setTransformers, onRemove, onSelect, onReset, activeTransformer }: TransformerStackProps) => {
    const [expanded, setExpanded] = useState(true);

    const handleToggle = () => {
        setExpanded(!expanded);
    };

    const onSave = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function replacer(_: string, value: any) {
            if (value instanceof Map) {
                return {
                    dataType: 'Map',
                    value: Array.from(value.entries()),
                }
            }
            else if (value instanceof Set) {
                return {
                    dataType: 'Set',
                    value: Array.from(value.values()),
                }
            }
            else {
                return value;
            }
        }

        const json = JSON.stringify(transformers.map(t => ({
            id: t.id || v4(),
            name: t.name,
            options: t.options
        })), replacer, 2);

        downloadAsFile(json, 'transformers.json', 'application/json');
    }

    const fileInputRef = useRef<HTMLInputElement>(null);

    const triggerImport = () => {
        fileInputRef.current?.click();
    };

    const onImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function reviver(_: string, value: any) {
            if (typeof value === 'object' && value !== null) {
                if (value.dataType === 'Map') {
                    return new Map(value.value);
                }
                else if (value.dataType === 'Set') {
                    return new Set(value.value);
                }
            }
            return value;
        }

        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const result = e.target?.result;
                if (typeof result !== "string") return;
                const imported = JSON.parse(result, reviver);
                if (!Array.isArray(imported)) {
                    console.log("Imported data is not an array");
                    return;
                }

                setTransformers(
                    imported
                        .map(t => {
                            let transformer: Transformer | null = null;
                            if (t.name === 'InsertDynamicsInstructions') {
                                transformer = new InsertDynamicsInstructions();
                            }
                            else if (t.name === 'InsertDynamicsGradient') {
                                transformer = new InsertDynamicsGradient();
                            }
                            else if (t.name === 'InsertTemporalSpread') {
                                transformer = new InsertTemporalSpread();
                            }
                            else if (t.name === 'InsertRubato') {
                                transformer = new InsertRubato();
                            }
                            else if (t.name === 'ApproximateLogarithmicTempo') {
                                transformer = new ApproximateLogarithmicTempo();
                            }
                            else if (t.name === 'InsertMetricalAccentuation') {
                                transformer = new InsertMetricalAccentuation();
                            }
                            else if (t.name === 'InsertRelativeDuration') {
                                transformer = new InsertRelativeDuration();
                            }
                            else if (t.name === 'InsertRelativeVolume') {
                                transformer = new InsertRelativeVolume();
                            }
                            else if (t.name === 'InsertPedal') {
                                transformer = new InsertPedal();
                            }
                            else if (t.name === 'CombineAdjacentRubatos') {
                                transformer = new CombineAdjacentRubatos();
                            }
                            else if (t.name === 'StylizeOrnamentation') {
                                transformer = new StylizeOrnamentation();
                            }
                            else if (t.name === 'StylizeArticulation') {
                                transformer = new StylizeArticulation();
                            }
                            else if (t.name === 'TranslatePhyiscalTimeToTicks') {
                                transformer = new TranslatePhyiscalTimeToTicks();
                            }
                            else if (t.name === 'MergeMetricalAccentuations') {
                                transformer = new MergeMetricalAccentuations();
                            }
                            else if (t.name === 'InsertArticulation') {
                                transformer = new InsertArticulation();
                            }
                            else {
                                return null;
                            }
                            transformer.id = t.id || v4();
                            transformer.options = t.options;
                            return transformer;
                        })
                        .filter(t => t !== null)
                );
            } catch (error) {
                console.error("Error importing transformers:", error);
            }
        };
        reader.readAsText(file);
    };

    const messages = validate(transformers);

    useEffect(() => {
        return monitorForElements({
            canMonitor({ source }) {
                return isTransformerData(source.data);
            },
            onDrop({ location, source }) {
                const target = location.current.dropTargets[0];
                if (!target) {
                    return;
                }

                const sourceData = source.data;
                const targetData = target.data;

                if (!isTransformerData(sourceData) || !isTransformerData(targetData)) {
                    return;
                }

                const indexOfSource = transformers.findIndex(t => t.id === sourceData.transformerId);
                const indexOfTarget = transformers.findIndex(t => t.id === targetData.transformerId);

                if (indexOfTarget < 0 || indexOfSource < 0) {
                    return;
                }

                const closestEdgeOfTarget = extractClosestEdge(targetData);

                // Using `flushSync` so we can query the DOM straight after this line
                flushSync(() => {
                    setTransformers(
                        reorderWithEdge({
                            list: transformers,
                            startIndex: indexOfSource,
                            indexOfTarget,
                            closestEdgeOfTarget,
                            axis: 'vertical',
                        }),
                    );
                });
                // Being simple and just querying for the transformer after the drop.
                // We could use react context to register the element in a lookup,
                // and then we could retrieve that element after the drop and use
                // `triggerPostMoveFlash`. But this gets the job done.
                const element = document.querySelector(`[data-transformer-id="${sourceData.transformerId}"]`);
                if (element instanceof HTMLElement) {
                    triggerPostMoveFlash(element);
                }
            },
        });
    }, [transformers, setTransformers]);

    return (
        <Card>
            <List>
                <ListItem
                    secondaryAction={
                        <IconButton edge="end" onClick={handleToggle}>
                            {expanded ? <ExpandLess /> : <ExpandMore />}
                        </IconButton>
                    }
                >
                    <ListItemText primary="History" />
                </ListItem>
                <Collapse in={expanded} timeout="auto" unmountOnExit>
                    <Stack direction="row">
                        <IconButton
                            onClick={onReset}
                        >
                            <RestartAlt />
                        </IconButton>
                        <IconButton
                            disabled={transformers.length === 0}
                            onClick={onSave}
                        >
                            <Save />
                        </IconButton>

                        <>
                            <IconButton onClick={triggerImport}>
                                <UploadFile />
                            </IconButton>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={onImport}
                                style={{ display: 'none' }}
                                accept="application/json"
                            />
                        </>

                        <IconButton onClick={() => setTransformers([])}>
                            <Clear />
                        </IconButton>
                    </Stack>

                    <div style={{ maxHeight: '80vh', overflow: 'scroll', maxWidth: 450 }}>
                        {transformers.map((transformer, index) => {
                            const message = messages.find(m => m.index === index);
                            return (
                                <TransformerListItem
                                    key={`transformer_${index}`}
                                    transformer={transformer}
                                    onRemove={() => onRemove(transformer)}
                                    onSelect={() => onSelect(transformer)}
                                    selected={activeTransformer === transformer}
                                    message={message}
                                />
                            )
                        })}
                    </div>
                </Collapse>
            </List>
        </Card>
    );
};