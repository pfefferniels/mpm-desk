import { Checkbox, FormControlLabel, Tooltip } from '@mui/material';

interface ToolCheckboxProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    tooltip?: string;
}

/**
 * A checkbox that belongs in a toolbar row rather than in a form.
 *
 * ## Two defaults that are sized for a form, not for a bar
 *
 * **Height.** A small `Checkbox` is a 20px glyph inside `padding: 9`, MUI's touch target, making
 * 38px before `FormControlLabel` adds its `-11px` left margin and its label. Beside a 30.75px
 * small `Button` in a 44px row that is the tallest thing present and the one carrying the least
 * weight. The padding comes down to 4 and the negative margin goes, that margin existing to pull
 * an over-padded control into a form's grid and there being no grid here.
 *
 * **Type.** `FormControlLabel` sets its label in `body1`, 16px, which next to `ToolGroup`'s 10px
 * captions and a button's 13px is the largest text in the bar on the item with the smallest claim
 * on the eye. `caption` puts it at 12px, a step below the buttons it sits with.
 *
 * ## The tooltip wrapper is unconditional
 *
 * As `ToolbarButton`'s is, avoiding the same trap differently: a `Tooltip` conditional on
 * `tooltip` would change the element type at this position the day a caller computes the hint,
 * remounting the checkbox. MUI's `Tooltip` declines to open on an empty title (`if (!title &&
 * title !== 0) open = false`, in `Tooltip.js`), so it is always mounted and `''` never shows.
 */
export const ToolCheckbox = ({ checked, onChange, label, tooltip }: ToolCheckboxProps) => (
    <Tooltip describeChild title={tooltip ?? ''}>
        <FormControlLabel
            control={
                <Checkbox
                    size='small'
                    checked={checked}
                    onChange={(event) => onChange(event.target.checked)}
                    sx={{ p: 0.5 }}
                />
            }
            label={label}
            sx={{
                flexShrink: 0,
                ml: 0,
                mr: 0.25,
                '& .MuiFormControlLabel-label': { typography: 'caption', whiteSpace: 'nowrap' },
            }}
        />
    </Tooltip>
);
