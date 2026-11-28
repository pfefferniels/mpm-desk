import { useState, type ReactNode } from 'react';
import { Box, Button, InputBase, Link, Paper, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import type { RemarkReport } from '../../fitting/description/client';
import type { Call } from '../../model/Work';
import type { Asked } from './asking';
import { displacedBy, type Remark } from './document';
import { WORDS_FAMILY } from './roll/tones';
import { dayOf, displacingOf, failureOf, gaveWayOf, whereOf, wroteOf } from './words';

interface RemarkCardProps {
    remark: Remark;
    /** Where it was made, in words. */
    place: string;
    /** What it came to in the run on screen; null while there is none of it. */
    report: RemarkReport | null;
    /** What is known of its way through the expert. */
    asked: Asked | null;
    bars: readonly { n: number; from: number; to: number }[];
    /** The calls made by hand in the document that was run, by their ids. */
    madeByHand: ReadonlyMap<string, Call>;
    /** False in the viewer: it is read, and nothing of it is changed. */
    editable: boolean;
    /** Whether there is a key to ask the expert with. */
    hasKey: boolean;
    /** The key field, shown where a remark waits for one. */
    keyField: ReactNode;
    /** The words were changed. */
    onReword: (text: string) => void;
    onAsk: () => void;
    onStop: () => void;
    onDelete: () => void;
    /** The reader's answer to what the expert asked. */
    onReply: (answer: string) => void;
    /** The reader's word on what the answer would take the place of. */
    onReplace: () => void;
    onKeep: () => void;
    /** Go to a call: one the remark became, or one made by hand it met. Select it, on the desk that shows it. */
    onOpenCall: (id: string) => void;
}

/** How many of a step's calls are offered as links before the rest are only counted. */
const LINKS = 8;

const alike = (calls: readonly { name: string }[]) => calls.every((call) => call.name === calls[0].name);

/** What a run said, as a sentence of its own. */
const sentence = (said: string) => `${said.charAt(0).toUpperCase()}${said.slice(1)}${/[.!?]$/.test(said) ? '' : '.'}`;

const pulse = keyframes({ '0%, 100%': { opacity: 0.25 }, '50%': { opacity: 1 } });

const Note = ({ tone, children }: { tone: 'trouble' | 'question' | 'plain'; children: ReactNode }) => (
    <Box
        sx={{
            borderRadius: 1,
            px: 1,
            py: 0.75,
            typography: 'body2',
            overflowWrap: 'anywhere',
            ...(tone === 'trouble' && { bgcolor: '#fdecea', color: 'error.dark' }),
            ...(tone === 'question' && { bgcolor: '#e3f1ee', color: 'text.primary' }),
            ...(tone === 'plain' && { bgcolor: 'action.hover', color: 'text.secondary' }),
        }}
    >
        {children}
    </Box>
);

/** Calls as links, told apart by where they act; beyond a few, the rest are only counted. */
const Calls = ({
    calls,
    bars,
    named,
    onOpen,
}: {
    calls: readonly Call[];
    bars: RemarkCardProps['bars'];
    /** Whether each link says what the call is, where they are not all of one kind anyway. */
    named: boolean;
    onOpen: (id: string) => void;
}) => (
    <>
        {calls.slice(0, LINKS).map((call, at) => (
            <Link
                key={call.id}
                component="button"
                type="button"
                variant="caption"
                underline="hover"
                data-call={call.id}
                title={`${call.name}: select this call on its own desk`}
                onClick={() => onOpen(call.id)}
            >
                {calls.length === 1 && named ? call.name : alike(calls) || !named ? whereOf(call, at, bars) : `${call.name}, ${whereOf(call, at, bars)}`}
            </Link>
        ))}
        {calls.length > LINKS && (
            <Typography variant="caption" color="text.secondary">
                and {calls.length - LINKS} more
            </Typography>
        )}
    </>
);

/**
 * A remark called up: its words, who turned them into steps and when, what each step became, and
 * whatever stands between it and being done.
 *
 * ## Where it meets what was made by hand
 *
 * An answer that would take the place of calls made on the other desks is not written until the
 * reader has said so. The card asks, in one sentence that names those calls as their own desks
 * do, and offers the two answers there are: replace them, or keep them and let the remark stand
 * behind them. It is the reader who is asked, not the expert, so there is no field to answer in.
 *
 * Afterwards each step says what became of it there: that it stands behind what was drawn by
 * hand, or was cut round it, with links to those calls.
 *
 * In the editor the words are a field: changing them is saying the remark anew, and it is asked
 * again. What a step became is a list of links to the calls it resolved to, which are plain calls
 * of the Desk: a link selects one on the desk that shows it, as a link to a call does anywhere.
 */
export const RemarkCard = ({
    remark,
    place,
    report,
    asked,
    bars,
    madeByHand,
    editable,
    hasKey,
    keyField,
    onReword,
    onAsk,
    onStop,
    onDelete,
    onReply,
    onReplace,
    onKeep,
    onOpenCall,
}: RemarkCardProps) => {
    // The words as they are being changed; null while they are as the document has them.
    const [typed, setTyped] = useState<string | null>(null);
    const [reply, setReply] = useState('');

    const turn = asked?.turn ?? null;
    // What its answer would take the place of, where the reader is asked before it is written.
    const displaced = asked?.displacing ? displacedBy(asked.displacing.run, remark.id) : null;
    const awaited = turn !== null || ((asked?.answer ?? null) !== null && displaced === null);
    const question = asked?.question ?? null;
    const failure = asked?.failure ?? null;
    const concrete = new Map((report?.concrete ?? []).map((call) => [call.id, call]));
    const untold =
        remark.steps.length === 0 && remark.model === null && !awaited && displaced === null && question === null && failure === null;
    const doing =
        turn === 'waiting'
            ? 'Waiting for its turn…'
            : turn === 'asking'
              ? (asked?.progress ?? 'Reading the remark…')
              : asked?.kept
                ? 'Writing it behind what was drawn by hand…'
                : 'Trying it out on the document…';

    const commit = () => {
        const text = (typed ?? '').trim();
        setTyped(null);
        if (text !== '' && text !== remark.text) onReword(text);
    };
    const answered = [remark.model ?? (remark.steps.length > 0 ? 'steps written by hand' : null), dayOf(remark.date)].filter(Boolean).join(' · ');

    return (
        <Paper
            data-remark-card={remark.id}
            elevation={6}
            sx={{
                width: 340,
                maxWidth: 'calc(100vw - 32px)',
                p: '11px 12px 9px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                position: 'relative',
                '&::before': { content: '""', position: 'absolute', left: 5, top: 10, bottom: 10, width: 3, borderRadius: 1, bgcolor: 'text.disabled' },
            }}
        >
            {editable ? (
                <InputBase
                    multiline
                    value={typed ?? remark.text}
                    onChange={(event) => setTyped(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            (event.target as HTMLElement).blur();
                        } else if (event.key === 'Escape') {
                            event.stopPropagation();
                            setTyped(null);
                        }
                    }}
                    inputProps={{ 'aria-label': 'The remark', spellCheck: false }}
                    sx={{ fontFamily: WORDS_FAMILY, fontSize: 18, lineHeight: 1.25, p: 0, color: 'text.primary' }}
                />
            ) : (
                <Typography sx={{ fontFamily: WORDS_FAMILY, fontSize: 18, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{remark.text}</Typography>
            )}
            <Typography variant="caption" color="text.secondary">
                {[place, answered].filter(Boolean).join(' · ')}
            </Typography>

            {awaited && (
                <Typography variant="body2" color="text.secondary" data-reading>
                    <Box
                        component="span"
                        sx={{
                            display: 'inline-block',
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            bgcolor: '#0b7566',
                            mr: 0.75,
                            animation: `${pulse} 1.1s ease-in-out infinite`,
                            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                        }}
                    />
                    {doing}
                </Typography>
            )}

            {displaced !== null && (
                <Note tone="question">
                    <Box data-displacing>This would {displacingOf(displaced, remark.about, bars)}.</Box>
                    {editable && (
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75, ml: -0.75 }}>
                            <Button
                                variant="text"
                                color="inherit"
                                title="Take them out and write the remark in their place. One step of undo brings them back."
                                onClick={onReplace}
                            >
                                Replace
                            </Button>
                            <Button
                                variant="text"
                                color="inherit"
                                title="Leave them as they are. The remark is written and stands behind them."
                                onClick={onKeep}
                            >
                                Keep
                            </Button>
                        </Box>
                    )}
                </Note>
            )}

            {question !== null && (
                <Note tone="question">
                    <Box data-question>{question}</Box>
                    {editable && hasKey && (
                        <InputBase
                            fullWidth
                            placeholder="Your answer"
                            value={reply}
                            onChange={(event) => setReply(event.target.value)}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key !== 'Enter' || reply.trim() === '') return;
                                onReply(reply.trim());
                                setReply('');
                            }}
                            inputProps={{ 'aria-label': 'Your answer' }}
                            sx={{ mt: 0.75, px: 0.75, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, fontSize: 14 }}
                        />
                    )}
                </Note>
            )}

            {failure !== null && <Note tone="trouble">{failureOf(failure)}</Note>}

            {untold && (
                <Note tone="plain">
                    This remark has not been turned into steps{editable && !hasKey ? ': there is no key to ask the expert with.' : '.'}
                    {editable && !hasKey && <Box sx={{ mt: 1 }}>{keyField}</Box>}
                </Note>
            )}

            {remark.steps.length > 0 && (
                <Box component="ol" data-steps sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {remark.steps.map((step, index) => {
                        const told = report?.steps[index];
                        const calls = (told?.calls ?? []).flatMap((id) => concrete.get(id) ?? []);
                        const wrote = told ? wroteOf(told) : '';
                        const gaveWayTo = told?.gaveWayTo ?? [];
                        const met = gaveWayTo.flatMap((id) => madeByHand.get(id) ?? []);
                        return (
                            <Box component="li" key={index} data-step={step.name} sx={{ typography: 'body2' }}>
                                <Box component="span" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 }}>
                                    {step.name}
                                </Box>
                                {wrote !== '' && (
                                    <Typography component="span" variant="caption" color="text.secondary">
                                        {' '}
                                        wrote {wrote}
                                    </Typography>
                                )}
                                {calls.length > 0 && (
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px', mt: 0.25 }}>
                                        {/* Calls of one name are told apart by where they act, and named once. */}
                                        {calls.length > 1 && alike(calls) && (
                                            <Typography variant="caption" color="text.secondary">
                                                {calls[0].name}:
                                            </Typography>
                                        )}
                                        <Calls calls={calls} bars={bars} named onOpen={onOpenCall} />
                                    </Box>
                                )}
                                {gaveWayTo.length > 0 && (
                                    <Note tone="plain">
                                        <Box data-gave-way={told?.behind !== undefined ? 'behind' : 'cut'}>
                                            {told?.behind !== undefined ? 'Stands behind' : 'Cut round'} what was drawn by hand here:{' '}
                                            {gaveWayOf(gaveWayTo, madeByHand)}.
                                        </Box>
                                        {met.length > 0 && (
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px', mt: 0.25 }}>
                                                <Calls calls={met} bars={bars} named={false} onOpen={onOpenCall} />
                                            </Box>
                                        )}
                                    </Note>
                                )}
                                {told?.error !== undefined && (
                                    <Note tone="trouble">
                                        {step.name} did not run: {told.error}
                                    </Note>
                                )}
                                {told?.withheld !== undefined && <Note tone="plain">Not written into the document. {sentence(told.withheld)}</Note>}
                            </Box>
                        );
                    })}
                </Box>
            )}

            {editable && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, ml: -0.75 }}>
                    {turn !== null && (
                        <Button variant="text" color="inherit" onClick={onStop}>
                            Stop
                        </Button>
                    )}
                    {turn === null && hasKey && (
                        <Button variant="text" color="inherit" onClick={onAsk}>
                            {untold ? 'Ask the expert' : 'Ask again'}
                        </Button>
                    )}
                    <Button variant="text" color="inherit" onClick={onDelete}>
                        Delete
                    </Button>
                </Box>
            )}
        </Paper>
    );
};
