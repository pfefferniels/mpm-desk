import { Card, Collapse, ListItemButton, ListItemIcon, Stack } from "@mui/material";
import { Transformer } from "mpmify/lib/transformers/Transformer";
import { useState } from "react";
import {
    List,
    ListItem,
    ListItemText,
    IconButton,
} from "@mui/material";
import { Delete, ErrorOutline, ExpandLess, ExpandMore, RestartAlt, Save, Warning } from "@mui/icons-material";
import { downloadAsFile } from "./utils";
import { validate, ValidationMessage } from "mpmify";

interface TransformerListItemProps {
    transformer: Transformer;
    message?: ValidationMessage
    onRemove: () => void;
    onSelect: () => void;
    selected: boolean;
}

const TransformerListItem = ({ transformer, onRemove, onSelect, selected, message }: TransformerListItemProps) => {
    const [expanded, setExpanded] = useState(false);

    const optionsString = JSON.stringify(transformer.options);
    const displayText =
        message
            ? <span>{message.message}</span>
            : (
                optionsString.length > 20 && !expanded
                    ? optionsString.slice(0, 20) + "..."
                    : optionsString);
    const isLong = optionsString.length > 20;

    return (
        <ListItem divider>
            {message && (
                <ListItemIcon>
                    {message.type === 'error' && <ErrorOutline color="error" />}
                    {message.type === 'warning' && <Warning color="warning" />}
                </ListItemIcon>
            )}
            <ListItemButton
                onClick={onSelect}
                selected={selected}
            >
                <ListItemText primary={transformer.name} secondary={displayText} title="test" />
                {isLong && (
                    <IconButton
                        onClick={(e) => {
                            e.stopPropagation();
                            setExpanded(!expanded);
                        }}
                    >
                        {expanded ? <ExpandLess /> : <ExpandMore />}
                    </IconButton>
                )}
                <IconButton
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                >
                    <Delete />
                </IconButton>
            </ListItemButton>
        </ListItem>
    );
};

interface TransformerStackProps {
    transformers: Transformer[];
    onRemove: (transformer: Transformer) => void;
    onSelect: (transformer: Transformer) => void;
    onReset: () => void;
    activeTransformer?: Transformer;
}

export const TransformerStack = ({ transformers, onRemove, onSelect, onReset, activeTransformer }: TransformerStackProps) => {
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