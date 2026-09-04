import { Clear } from '@mui/icons-material';
import { Box, IconButton, InputAdornment, TextField } from '@mui/material';
import { ToolLabel } from './ToolGroup';

interface ToolFieldProps {
    /** Shown beside the field, and used as the field's accessible name. */
    label: string;
    value: string | number;
    /**
     * Always a string, even at `type='number'`. That is what the DOM hands over, and `''` is a
     * state a number field can genuinely be in that no number represents — `Number('')` is 0, so a
     * field that parsed here would snap an emptied box back to zero under the user's cursor.
     * Parsing, and deciding what an empty box means, stay with the caller.
     */
    onChange: (value: string) => void;
    type?: 'text' | 'number';
    width?: number;
    placeholder?: string;
    clearable?: boolean;
}

/**
 * A text or number field that can stand in a toolbar row without wrecking it.
 *
 * ## The height, which is the whole reason this exists
 *
 * MUI's small controls are not one height, and a bare `<TextField size='small'>` is the tallest
 * thing in the room. Read off the components' own style functions: a small `OutlinedInput` pads
 * `8.5px` above and below an input of `1.4375em` at 16px, so **40px**; a small outlined `Button`
 * pads `3px` around 13px type at `typography.button`'s line height of 1.75 plus a 1px border
 * each side, so **30.75px**. In a 44px bar the field alone sets the row's height and every button
 * beside it floats in a space it did not ask for.
 *
 * So the input's height is forced to 30, and the row's height is the bar's decision rather than
 * the tallest control's.
 *
 * ## No floating label
 *
 * MUI's `InputLabel` animates up to sit *in* the border, which is why the outlined variant draws
 * its border as a `<fieldset>` with a notch in the top. That notch needs a field tall enough to
 * have a top to cut into; at 30px the label overlaps the input text and lands half outside the
 * control. The name goes beside the field, in `ToolGroup`'s treatment of its caption, so
 * `InputLabelProps` is *absent* rather than configured: there is no label element, and the
 * accessible name is stated on the input.
 *
 * `InputProps` and `inputProps` rather than `slotProps`: this is `@mui/material` 5.18, whose
 * `TextField` has no `slotProps` prop — it is not in the component's prop list — so the newer
 * spelling silently lands in `...other` and reaches the DOM.
 */
export const ToolField = ({
    label,
    value,
    onChange,
    type = 'text',
    width = 96,
    placeholder,
    clearable,
}: ToolFieldProps) => (
    <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <ToolLabel>{label}</ToolLabel>
        <TextField
            size='small'
            variant='outlined'
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            inputProps={{ 'aria-label': label }}
            InputProps={
                clearable && String(value) !== ''
                    ? {
                          endAdornment: (
                              <InputAdornment position='end'>
                                  <IconButton
                                      size='small'
                                      edge='end'
                                      // Its own name, because it is its own control: a screen
                                      // reader lands on it after the input and "button" alone
                                      // says nothing about which field it empties.
                                      aria-label={`Clear ${label}`}
                                      onClick={() => onChange('')}
                                      sx={{ p: 0.25 }}
                                  >
                                      <Clear sx={{ fontSize: 16 }} />
                                  </IconButton>
                              </InputAdornment>
                          ),
                      }
                    : undefined
            }
            sx={{ width, '& .MuiInputBase-root': { height: 30 } }}
        />
    </Box>
);
