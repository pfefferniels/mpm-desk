import { Card, Collapse, Stack } from "@mui/material";
import { Transformer } from "mpmify/lib/transformers/Transformer";
import { useCallback, useState } from "react";
import {
    List,
    ListItem,
    ListItemText,
    IconButton,
} from "@mui/material";
import { Clear, DeleteForever, ExpandLess, ExpandMore, RestartAlt } from "@mui/icons-material";
import { TransformerListItem } from "./TransformerListItem";
import { ArgumentationCard } from "./ArgumentationCard";
import { Argumentation } from "mpmify";

interface TransformerStackProps {
    transformers: Transformer[];
    setTransformers: (transformers: Transformer[]) => void;

    onRemove: (transformer: Transformer) => void;
    onSelect: (transformer?: Transformer) => void;
    onReset: () => void;
    activeTransformer?: Transformer;
}

export const TransformerStack = ({ transformers, setTransformers, onRemove, onSelect, onReset, activeTransformer }: TransformerStackProps) => {
    const [expanded, setExpanded] = useState(true);

    const handleToggle = () => {
        setExpanded(!expanded);
    };

    const argumentations = Map.groupBy(transformers, t => t.argumentation)

    const mergeInto = useCallback((transformerId: string, argumentation: Argumentation) => {
        const transformer = transformers.find(t => t.id === transformerId);
        if (!transformer) return;
        transformer.argumentation = argumentation;
        setTransformers([...transformers]);
    }
        , [transformers, setTransformers]);

    return (
        <>
            <Card elevation={7} sx={{
                backdropFilter: 'blur(14px)',
                background: 'rgba(255, 255, 255, 0.5)',
            }}>
                <List sx={{ minWidth: 350 }}>
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

                        <List>
                            <div style={{ maxHeight: '80vh', overflow: 'scroll', maxWidth: 450 }}>
                                {Array
                                    .from(argumentations.entries())
                                    .map(([argumentation, localTransformers]) => {
                                        return (
                                            <>
                                                <ArgumentationCard
                                                    argumentation={argumentation}
                                                    onChange={() => {
                                                        // todo
                                                    }}
                                                    mergeInto={mergeInto}
                                                />
                                                <Collapse in={true} timeout="auto" unmountOnExit>
                                                    <List dense>
                                                        {localTransformers.map((transformer) => {
                                                            const index = transformers.indexOf(transformer);

                                                            return (
                                                                <TransformerListItem
                                                                    key={`transformer_${index}`}
                                                                    transformer={transformer}
                                                                    index={index}
                                                                    onSelect={() => onSelect(transformer)}
                                                                    onRemove={() => onRemove(transformer)}
                                                                    selected={activeTransformer?.id === transformer.id}
                                                                />
                                                            )
                                                        })}
                                                    </List>
                                                </Collapse>
                                            </>
                                        )
                                    })}
                            </div>
                        </List>
                    </Collapse>
                </List>
            </Card >
        </>
    );
};