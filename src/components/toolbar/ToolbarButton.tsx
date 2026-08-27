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
 * The `<span>` is **unconditional**, and that is the whole reason this is a component rather than
 * two lines at each call site. A disabled MUI button dispatches no pointer events, so a `Tooltip`
 * around one never hears the hover and never opens; the documented fix is a wrapper element that
 * does. Wrapping *only when disabled* looks like the tighter version and is a bug: the element type
 * at that position in the tree changes the moment `disabled` flips, React unmounts the button and
 * mounts a new one, and the keyboard focus that was on it is gone. `AppMenu` wrapped two of its
 * three tooltipped controls by hand and not the third, which is the other failure mode — a rule
 * everybody has to remember is a rule that is followed most of the time.
 *
 * `describeChild` says the tooltip is a *description*, not a name, and it was verified against
 * `node_modules/@mui/material/Tooltip/Tooltip.js` rather than assumed. The cloned child's props are
 * assembled as `{...nameOrDescProps, ...other, ...children.props}` with `children.props` **last**,
 * so whatever the child already declares beats what the tooltip wants to add. Without
 * `describeChild` the tooltip's contribution is `aria-label: title`; with it, `aria-describedby`
 * while the tooltip is open and the native `title` attribute while it is closed.
 *
 * Be clear about where that lands: the tooltip's child is this wrapper, not the button, so the
 * description is attached to the wrapper. It is the button that carries the name, stated outright
 * as `label ?? tooltip`. So in the ordinary case — no `label` — the tooltip's own words *are* the
 * button's accessible name and nothing depends on the description at all; a `label` is what trades
 * that guarantee for a better name, and should be given only when the tooltip is genuinely not one.
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
 * `contained` is reachable only through `primary`, and that is a design rule made checkable. The
 * bar wants exactly one filled button per desk — the thing the desk is for — and everything else
 * outlined. What it had instead: 44 `<Button>`s across the desks and the app's own chrome spelling
 * their emphasis three ways, ten `contained`, twenty `outlined` and fourteen with no `variant` at
 * all, which is MUI's `text`. Eight separate files reach for `contained`, and nothing anywhere said
 * which of those was its desk's one principal action rather than a button that happened to want
 * some weight. Routing emphasis through a named boolean turns "how many filled buttons does this
 * desk have?" into one grep and one test.
 *
 * Checkable is not enforced, and the comment should not pretend otherwise. Nothing in this file can
 * count buttons across two `ToolGroup`s, let alone across a desk's toolbar and the app's own; a
 * desk that sets `primary` twice renders two filled buttons and no type error. What the prop buys
 * is that the question can be asked at all.
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
