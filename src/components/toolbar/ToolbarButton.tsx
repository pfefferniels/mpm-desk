import { Button, IconButton, ToggleButton, Tooltip } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';

interface ToolControlProps {
    /** The button's text. Omit it for an icon-only button — that is what picks `IconButton`. */
    children?: ReactNode;
    icon?: ReactNode;
    /**
     * Required, and that is the point.
     *
     * This bar makes "disabled, with a tooltip explaining why" its commonest state — a desk shows
     * every control it has and greys out the ones the current selection cannot reach, rather than
     * hiding them and leaving the user to guess what makes them appear. A disabled control with no
     * explanation is a dead end, so there is no way to write one here.
     */
    tooltip: string;
    /**
     * The accessible name, when the tooltip is not a good one — a tooltip that says *why* a control
     * is disabled makes a poor name for it. Defaults to `tooltip`.
     */
    label?: string;
    disabled?: boolean;
}

/**
 * The tooltip, and the wrapper the tooltip needs.
 *
 * The `<span>` is **unconditional**, which is why this is a component rather than two lines at
 * each call site. A disabled MUI button dispatches no pointer events, so a `Tooltip` around one
 * never hears the hover; the documented fix is a wrapper that does. Wrapping *only when disabled*
 * is a bug: the element type at that position changes the moment `disabled` flips, so React
 * unmounts the button, mounts a new one, and the keyboard focus on it is gone.
 *
 * `describeChild` says the tooltip is a *description* rather than a name, verified against
 * `node_modules/@mui/material/Tooltip/Tooltip.js`. The cloned child's props are assembled as
 * `{...nameOrDescProps, ...other, ...children.props}` with `children.props` **last**, so what the
 * child declares beats what the tooltip adds. Without `describeChild` the tooltip contributes
 * `aria-label: title`; with it, `aria-describedby` while open and the native `title` while closed.
 *
 * The tooltip's child is this wrapper rather than the button, so the description lands on the
 * wrapper. The button carries the name, stated as `label ?? tooltip`. With no `label` the
 * tooltip's own words *are* the accessible name and nothing depends on the description; a `label`
 * trades that guarantee for a better name, so give one only when the tooltip is not a name.
 */
const Hinted = ({ tooltip, children }: { tooltip: string; children: ReactElement }) => (
    <Tooltip describeChild title={tooltip}>
        <span style={{ display: 'inline-flex' }}>{children}</span>
    </Tooltip>
);

interface ToolbarButtonProps extends ToolControlProps {
    /** The one filled button of a desk: the action the desk exists to perform. */
    primary?: boolean;
    onClick: () => void;
}

/**
 * A button in the app bar.
 *
 * ## There is deliberately no `variant` prop
 *
 * `contained` is reachable only through `primary`, which makes a design rule checkable. The bar
 * wants exactly one filled button per desk, the thing the desk is for, and everything else
 * outlined. Spelled as a `variant` the emphasis of 44 buttons is scattered over three values in
 * eight files, with nothing saying which `contained` is its desk's principal action rather than a
 * button that wanted some weight. A named boolean turns "how many filled buttons does this desk
 * have?" into one grep and one test.
 *
 * Checkable, not enforced. Nothing here can count buttons across two `ToolGroup`s, let alone
 * across a desk's toolbar and the app's own, so a desk that sets `primary` twice renders two
 * filled buttons and no type error. The prop buys the question being askable.
 */
export const ToolbarButton = ({
    children,
    icon,
    tooltip,
    label,
    disabled,
    primary,
    onClick,
}: ToolbarButtonProps) => (
    <Hinted tooltip={tooltip}>
        {children === undefined ? (
            <IconButton
                size='small'
                color={primary ? 'primary' : 'default'}
                aria-label={label ?? tooltip}
                disabled={disabled}
                onClick={onClick}
            >
                {icon}
            </IconButton>
        ) : (
            <Button
                size='small'
                disableElevation
                startIcon={icon}
                variant={primary ? 'contained' : 'outlined'}
                color={primary ? 'primary' : 'inherit'}
                aria-label={label ?? tooltip}
                disabled={disabled}
                onClick={onClick}
            >
                {children}
            </Button>
        )}
    </Hinted>
);

interface ToolbarToggleProps extends ToolControlProps {
    selected: boolean;
    /** Called with what the toggle is about to become — never with `null`, never with a tag. */
    onChange: (selected: boolean) => void;
}

/**
 * A control that is either on or off, and says so by staying pressed.
 *
 * ## Why `onChange` takes the next boolean rather than MUI's `(event, value)`
 *
 * MUI's signature answers a question the caller did not ask. A standalone `ToggleButton` hands its
 * `onChange` its own `value` prop — the same string on the way in and on the way out, so it says
 * nothing about which way the toggle just went — and a `ToggleButtonGroup` in `exclusive` mode
 * hands back `null` when the pressed button is pressed again. Either way the caller has to
 * reconstruct the intent from state it is already holding, and every desk reconstructs it slightly
 * differently: `TempoDesk` writes `prev => prev === 'draw' ? undefined : 'draw'` for one toggle and
 * `mode === 'split' ? setMode(undefined) : setMode('split')` for the next one, two spellings of the
 * same dance in adjacent groups.
 *
 * The toggle already knows whether it is selected, because it was told. So it answers the question
 * itself and hands over the one fact the caller wanted.
 */
export const ToolbarToggle = ({
    children,
    icon,
    tooltip,
    label,
    disabled,
    selected,
    onChange,
}: ToolbarToggleProps) => (
    <Hinted tooltip={tooltip}>
        <ToggleButton
            size='small'
            value='on'
            selected={selected}
            disabled={disabled}
            aria-label={label ?? tooltip}
            onChange={() => onChange(!selected)}
            sx={{ gap: 0.5 }}
        >
            {icon}
            {children}
        </ToggleButton>
    </Hinted>
);
