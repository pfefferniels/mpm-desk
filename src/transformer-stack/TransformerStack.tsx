import { Card, Collapse, Stack } from "@mui/material";
import { Transformer } from "mpmify/lib/transformers/Transformer";
import { useEffect, useState } from "react";
import {
    List,
    ListItem,
    ListItemText,
    IconButton,
} from "@mui/material";
import { ExpandLess, ExpandMore, RestartAlt, Save } from "@mui/icons-material";
import { downloadAsFile } from "../utils";
import { validate } from "mpmify";
import { flushSync } from "react-dom";
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { reorderWithEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/reorder-with-edge';
import { triggerPostMoveFlash } from '@atlaskit/pragmatic-drag-and-drop-flourish/trigger-post-move-flash';
import { isTransformerData } from "./transformer-data";
import { TransformerListItem } from "./TransformerListItem";

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
        const json = JSON.stringify(transformers.map(t => ({
            name: t.name,
            options: t.options
        })));
        downloadAsFile(json, 'transformers.json', 'application/json');
    }

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