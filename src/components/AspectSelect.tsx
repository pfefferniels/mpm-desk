import React, { useState, type ReactElement } from 'react';
import {
    Card,
    Collapse,
    Divider,
    IconButton,
    List,
    ListItemButton,
    ListItemText,
    Tooltip,
    Typography,
    useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ChevronRight, ExpandLess, ExpandMore, InfoOutlined } from '@mui/icons-material';
import { correspondingDesks, type DocumentFacts } from '../desks/DeskSwitch';
import { useEditable } from '../hooks/Editing';

/**
 * A row, and the wrapper a tooltip on a disabled row needs.
 *
 * The `<div>` is unconditional for the reason `ToolbarButton`'s `Hinted` records: a disabled MUI
 * button dispatches no pointer events, so a `Tooltip` around one never hears the hover, and
 * wrapping only when disabled changes the element type at that position the moment the reason
 * appears — React then unmounts the row and mounts a new one. An empty `title` renders no tooltip,
 * which is what the available rows get.
 *
 * A row that carries a reason is also handed no `onClick`. `disabled` on a `ListItemButton` is a
 * `<div role="button">` with `pointer-events: none` and its handler still attached, so the styling
 * is the only thing standing between the row and a click.
 */
const Row = ({ reason, children }: { reason?: string; children: ReactElement }) => (
    <Tooltip describeChild title={reason ?? ''} placement='left'>
        <div>{children}</div>
    </Tooltip>
);

/**
 * The mark at the end of a greyed row, saying the reason is there to be read.
 *
 * Grey alone says a row cannot be clicked, and nothing says why; a reader who does not know a
 * tooltip is waiting has no reason to hover a row that looks inert.
 *
 * The tooltip stays the row's rather than the icon's own. `pointer-events` are off across a
 * disabled `ListItemButton`, this icon included, so a hover over it lands on the wrapper `<div>`
 * that `Row` puts there and opens that one — the icon is what says there is one to open.
 *
 * At 16px against the row's 14px label, and in the row's own colour, so the disabled opacity fades
 * the two together.
 */
const Unmet = () => <InfoOutlined sx={{ fontSize: 16, flexShrink: 0 }} />;

/**
 * A row of the list, at the height a 14px label needs and no more.
 *
 * 32px is the floor rather than a snug fit: `dense` puts the label's own box at 28, which is under
 * what is comfortable to aim at. `ListItemText` carries 4px of margin above and below that would
 * otherwise push the row past the floor and undo it.
 *
 * Capitalised as the app bar capitalises the open desk's name, so that the row and the bar spell
 * one name the same way. The registry's aspects are lowercase and its display names are not.
 */
const rowStyle = { minHeight: 32, textTransform: 'capitalize', '& .MuiListItemText-root': { my: 0 } };

/** An aspect as the menu lists it: the desks that share it, and whether it opens a group. */
interface AspectRow {
    aspect: string;
    /**
     * What the row says, and for an aspect of one desk what a click on it selects: that desk's
     * name, `displayName ?? aspect`, which is what the app bar calls it once it is open and what
     * `App` puts in `selectedDesk` when it opens a call's desk. The aspect itself named a desk the
     * bar then called something else — `source choice` opened Base Text, `accentuation` opened
     * Metrical Accentuation — and a desk opened from a call was never marked in the menu.
     *
     * An aspect of several desks is a heading over their names, and says the aspect.
     */
    label: string;
    desks: typeof correspondingDesks;
    startsGroup: boolean;
}

/**
 * The registry as the menu draws it — one row per aspect, in registry order.
 *
 * A group is a run of neighbouring entries sharing a `group`, so an entry written away from its
 * group splits it in two on screen; `DeskSwitch.tsx` says as much where the list is written.
 *
 * The viewer's menu leaves out the desks that are the editor's alone (`editOnly`).
 */
const readAspectRows = (editable: boolean): AspectRow[] => {
    const desks = editable ? correspondingDesks : correspondingDesks.filter((desk) => !desk.editOnly);
    const byAspect = [...Map.groupBy(desks, (desk) => desk.aspect)];
    const groupAt = (index: number) => byAspect[index][1][0].group;

    return byAspect.map(([aspect, desks], index) => ({
        aspect,
        label: desks.length === 1 ? (desks[0].displayName ?? aspect) : aspect,
        desks,
        startsGroup: index > 0 && groupAt(index) !== groupAt(index - 1),
    }));
};

/** Read once for each mode: `correspondingDesks` is a table, and nothing edits it. */
const editorRows = readAspectRows(true);
const viewerRows = readAspectRows(false);

interface AspectSelectProps {
    selectedDesk: string;
    setSelectedDesk: (desk: string) => void;
    /** What the desks answer `unavailable` against — see `DeskSwitch.tsx`. */
    documentFacts: DocumentFacts;
}

export const AspectSelect: React.FC<AspectSelectProps> = ({
    selectedDesk,
    setSelectedDesk,
    documentFacts,
}) => {
    const [toExpand, setToExpand] = useState<string>();

    /**
     * A phone, where the open card is over half the screen and the plot is what was opened.
     *
     * There the card starts folded, and folds again once a desk is picked: on a window that
     * narrow it covers the desk it has just opened, and a reader who wanted the list again has the
     * same button that brought it out. On a wider window it opens and stays open, as it always
     * has. `noSsr` so the first render already knows, and a phone never sees the card open for a
     * frame.
     *
     * `useTheme` rather than a query written as a function of the theme: this module is rendered
     * without a `ThemeProvider` in its tests, and MUI's default theme answers the same question
     * with the same breakpoints.
     */
    const { breakpoints } = useTheme();
    const narrow = useMediaQuery(breakpoints.down('sm'), { noSsr: true });
    const [collapsed, setCollapsed] = useState(narrow);
    const aspectRows = useEditable() ? editorRows : viewerRows;

    const pick = (desk: string) => {
        setSelectedDesk(desk);
        if (narrow) setCollapsed(true);
    };

    return (
        <Card
            elevation={0}
            sx={{
                // Against the desk area rather than the page: `App` wraps the desk in a
                // positioned box, which is what this resolves against. Without one, `top: 0`
                // resolves against the initial containing block and the card paints over the
                // app bar's right end.
                position: 'absolute',
                top: 0,
                right: 0,
                marginTop: '1rem',
                marginRight: '1rem',
                // Above the desks, below the bar. The desks position their own overlays at
                // `zIndex: 1` and `5`, and an absolutely-positioned card at `auto` loses to
                // every one of them.
                zIndex: (theme) => theme.zIndex.appBar - 1,
                // Opaque, where this was `blur(17px)` under 60% white.
                //
                // What is behind it is a plot: note rectangles, gridlines and saturated curve
                // fills at high spatial frequency. Blurring that gives a mottled ground whose
                // luminance moves with whatever has been scrolled underneath, so the list's
                // own contrast is a function of the scroll position — and over the amber spans
                // the `saturate` boost averaged the plot's chroma into the panel and came out
                // as a cream wash. Covering the plot honestly beats half-showing it.
                bgcolor: 'background.paper',
                border: 1,
                borderColor: 'divider',
                width: 'fit-content',
                minWidth: collapsed ? undefined : '180px',
                // `ListItemButton.Mui-selected` tints with `alpha(primary.main, …)` rather than
                // `action.selected`, and against a near-black primary that tint is a hair off
                // the hover fill. A rule down the left edge says "this one" at a glance.
                '& .Mui-selected': {
                    bgcolor: 'action.hover',
                    boxShadow: (theme) => `inset 3px 0 0 ${theme.palette.primary.main}`,
                },
            }}
        >
            {collapsed ? (
                <IconButton
                    onClick={() => setCollapsed(false)}
                    size="small"
                    aria-label="Show the aspect list"
                    sx={{ m: 0.5 }}
                >
                    <ChevronRight fontSize="small" />
                </IconButton>
            ) : (
                <>
                    <ListItemButton onClick={() => setCollapsed(true)} dense>
                        <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
                            Aspects
                        </Typography>
                        <ExpandMore fontSize="small" sx={{ transform: 'rotate(90deg)' }} />
                    </ListItemButton>
                    <Divider />
                    {/* `dense` reaches the rows and their text through `ListContext`, so it sets
                        both the padding and the `body2` the labels are set in. */}
                    <List dense disablePadding>
                        {/* Metadata is an entry in `correspondingDesks` like any other now, so
                            it is listed by the loop below rather than written in by hand. Its
                            own group is what keeps the rule under it. */}
                        {aspectRows.map(({ aspect, label, desks, startsGroup }) => {
                            const reason = desks[0].unavailable?.(documentFacts);

                            return (
                                <React.Fragment key={aspect}>
                                    {startsGroup && <Divider sx={{ my: 0.5 }} />}
                                    {desks.length === 1 ? (
                                        <Row reason={reason}>
                                            <ListItemButton
                                                sx={rowStyle}
                                                selected={label === selectedDesk}
                                                disabled={reason !== undefined}
                                                onClick={
                                                    reason === undefined
                                                        ? () => {
                                                              pick(label);
                                                              setToExpand(undefined);
                                                          }
                                                        : undefined
                                                }
                                            >
                                                <ListItemText>{label}</ListItemText>
                                                {reason !== undefined && <Unmet />}
                                            </ListItemButton>
                                        </Row>
                                    ) : (
                                        <ListItemButton
                                            sx={rowStyle}
                                            selected={aspect === toExpand}
                                            onClick={() => {
                                                setToExpand(aspect === toExpand ? undefined : aspect);
                                            }}
                                        >
                                            <ListItemText>{aspect}</ListItemText>
                                            {aspect === toExpand ? (
                                                <ExpandLess fontSize="small" />
                                            ) : (
                                                <ExpandMore fontSize="small" />
                                            )}
                                        </ListItemButton>
                                    )}

                                    {desks.length > 1 && (
                                        <Collapse in={toExpand === aspect} timeout="auto" unmountOnExit>
                                            <List dense component='div' disablePadding sx={{ pl: 2 }}>
                                                {desks.map(({ displayName, unavailable }) => {
                                                    if (!displayName) return null;

                                                    const childReason = unavailable?.(documentFacts);

                                                    return (
                                                        <Row key={displayName} reason={childReason}>
                                                            <ListItemButton
                                                                sx={rowStyle}
                                                                selected={displayName === selectedDesk}
                                                                disabled={childReason !== undefined}
                                                                onClick={
                                                                    childReason === undefined
                                                                        ? () => pick(displayName)
                                                                        : undefined
                                                                }
                                                            >
                                                                <ListItemText>{displayName}</ListItemText>
                                                                {childReason !== undefined && <Unmet />}
                                                            </ListItemButton>
                                                        </Row>
                                                    );
                                                })}
                                            </List>
                                        </Collapse>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </List>
                </>
            )}
        </Card>
    );
};
