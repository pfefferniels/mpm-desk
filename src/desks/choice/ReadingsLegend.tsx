import { Box } from "@mui/material"
import { Fragment } from "react"
import { useCallSelection } from "../../hooks/CallSelection"
import { preferencesOf, readingName, type Preferred } from "./readings"

interface ReadingsLegendProps {
    /** Every reading, in the order the desk colours them. */
    readings: readonly string[]
    colorFor: (source: string) => string
    /** How many score notes the chain took from each reading. */
    taken: ReadonlyMap<string, number>
    /** How many score notes there are, so a count can say how much of the piece it is. */
    notes: number
    /** How far in the roll begins, so the key lines up with what it is the key to. */
    indent: number
}

/**
 * Which colour is which reading, and what the chain took from each.
 *
 * A row per reading: its name, the choices that prefer it and over what, and how many notes the
 * chain went on to take from it. The count is what happened and the preferences are what was
 * asked, and the two can differ: a choice made after another one over the same notes finds its
 * reading already set aside there and takes nothing.
 *
 * A preference is the only place a `MakeChoice` can be clicked, since it writes nothing into the
 * performance for a desk to draw. Clicking it selects the call, as clicking a curve selects the
 * call that drew it on the other desks, which in the viewer also puts its address in the URL.
 */
export const ReadingsLegend = ({ readings, colorFor, taken, notes, indent }: ReadingsLegendProps) => {
    const { calls, activeCallIds, setActiveCallIds, toggleActiveCall } = useCallSelection()
    const preferences = preferencesOf(calls)
    const decided = [...taken.values()].some(count => count > 0)

    return (
        <Box data-legend sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 1, pl: `${indent}px`, fontSize: '0.875rem' }}>
            {readings.map(source => {
                const preferred = preferences.filter(preference => preference.source === source)
                const count = taken.get(source) ?? 0

                return (
                    <Box key={source} data-reading={source} sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 24 }}>
                        <Box sx={{ width: 12, height: 12, flexShrink: 0, borderRadius: '2px', bgcolor: colorFor(source) }} />
                        <Box component='span' title={source} sx={{ fontVariantNumeric: 'tabular-nums', minWidth: '9ch' }}>
                            {readingName(source, readings)}
                        </Box>
                        {preferred.length > 0
                            ? (
                                <Box component='span'>
                                    {'preferred '}
                                    {preferred.map((preference, i) => (
                                        <Fragment key={`${preference.call}_${preference.source}`}>
                                            {i > 0 && ', '}
                                            <PreferenceButton
                                                preference={preference}
                                                selected={activeCallIds.has(preference.call)}
                                                onSelect={additive => {
                                                    if (additive) toggleActiveCall(preference.call)
                                                    else setActiveCallIds(new Set([preference.call]))
                                                }}
                                            />
                                        </Fragment>
                                    ))}
                                </Box>
                            )
                            : <Box component='span' sx={{ color: 'text.secondary' }}>not preferred</Box>}
                        <Box component='span' sx={{ color: 'text.secondary' }}>
                            {`· taken for ${count} of ${notes} notes`}
                        </Box>
                    </Box>
                )
            })}
            <Box component='span' sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                {decided
                    ? 'A solid bar is the reading taken, a dashed one a reading set aside. '
                        + 'The number beside it is its velocity less the one taken.'
                    : 'Nothing has been taken yet: every reading of every note still stands. '
                        + 'The number beside a bar is its velocity less the first reading’s.'}
            </Box>
        </Box>
    )
}

interface PreferenceButtonProps {
    preference: Preferred
    selected: boolean
    /** @param additive the selection is to grow or shrink by this call rather than be replaced */
    onSelect: (additive: boolean) => void
}

/** One choice preferring a reading, said as what it covers, and the handle that selects it. */
const PreferenceButton = ({ preference, selected, onSelect }: PreferenceButtonProps) => (
    <Box
        component='button'
        type='button'
        data-call={preference.call}
        aria-pressed={selected}
        title='Select the choice'
        onClick={event => onSelect(event.metaKey || event.ctrlKey || event.shiftKey)}
        sx={{
            font: 'inherit',
            color: 'inherit',
            border: 0,
            borderRadius: '4px',
            px: 0.5,
            py: 0.25,
            cursor: 'pointer',
            bgcolor: selected ? '#e5e7eb' : 'transparent',
            fontWeight: selected ? 600 : 400,
            textDecoration: selected ? 'none' : 'underline dotted',
            textUnderlineOffset: '3px',
            '&:hover': { bgcolor: selected ? '#e5e7eb' : '#f3f4f6' },
        }}
    >
        {preference.aspects
            ? `for ${listed(preference.aspects)}, over ${preference.scope}`
            : `for ${preference.scope}`}
    </Box>
)

/** `timing`, `timing and pedalling`, `loudness, timing and pedalling`. */
const listed = (words: readonly string[]): string =>
    words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
