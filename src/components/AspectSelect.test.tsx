/**
 * The aspect menu, and the one thing it does beyond listing the registry: it greys out a desk that
 * has nothing to do for the document in hand, marks it, and says why.
 *
 * Greyed rather than hidden, which is the rule `ToolbarButton` records for the toolbar — a control
 * that disappears leaves the reader to guess what makes it come back.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AspectSelect } from './AspectSelect';
import { correspondingDesks, type DocumentFacts } from '../desks/DeskSwitch';
import { EditingContext } from '../hooks/Editing';

/** A document every desk has work to do for — see `DeskSwitch.test.ts`. */
const FITTED: DocumentFacts = { readings: 2, aligned: 476, tempos: 9, unchosen: 0 };

/** One row as the reader meets it: the button, the reason behind it, and the mark that it is there. */
const rowNamed = (aspect: string) => {
    const label = screen.getByText(aspect);
    const row = label.closest('[role="button"]');
    return {
        row,
        // `describeChild` puts the reason on the wrapper as a native `title` while the tooltip is
        // closed, and the wrapper is where it has to be: a disabled MUI button dispatches no
        // pointer events, so a tooltip around the row itself would never hear a hover.
        wrapper: label.closest('div[title]'),
        icon: row?.querySelector('[data-testid="InfoOutlinedIcon"]') ?? null,
    };
};

const mount = (facts: Partial<DocumentFacts>, aspect = 'Base Text') => {
    const setSelectedDesk = vi.fn();
    const { container } = render(
        <AspectSelect
            selectedDesk='metadata'
            setSelectedDesk={setSelectedDesk}
            documentFacts={{ ...FITTED, ...facts }}
        />,
    );
    return { setSelectedDesk, container, ...rowNamed(aspect) };
};

describe('the aspect menu', () => {
    it('offers Base Text while the document holds two readings', () => {
        const { setSelectedDesk, row, wrapper, icon } = mount({ readings: 2 });
        expect(row).not.toHaveAttribute('aria-disabled', 'true');
        // An empty title is no tooltip, which is what a row with nothing to explain wants, and
        // nothing to explain is nothing to mark either.
        expect(wrapper?.getAttribute('title')).toBe('');
        expect(icon).toBeNull();

        fireEvent.click(row!);
        expect(setSelectedDesk).toHaveBeenCalledWith('Base Text');
    });

    it('names a desk of its own aspect as the app bar does, and marks it when it is open', () => {
        // The bar says `displayName ?? aspect`, and so does `App` when it opens the desk of a call.
        // A row that said, and sent, the aspect named the desk differently from the bar above it,
        // and was not marked when a link opened that desk.
        render(
            <AspectSelect
                selectedDesk='Metrical Accentuation'
                setSelectedDesk={() => {}}
                documentFacts={FITTED}
            />,
        );

        expect(screen.queryByText('accentuation')).not.toBeInTheDocument();
        expect(rowNamed('Metrical Accentuation').row).toHaveClass('Mui-selected');
        expect(rowNamed('Base Text').row).not.toHaveClass('Mui-selected');
    });

    it('greys out Base Text when there is only one recording, and says why', () => {
        const { setSelectedDesk, row, wrapper, icon } = mount({ readings: 1 });
        expect(row).toHaveAttribute('aria-disabled', 'true');
        expect(wrapper?.getAttribute('title')).toMatch(/one recording/i);
        expect(icon).not.toBeNull();

        fireEvent.click(row!);
        expect(setSelectedDesk).not.toHaveBeenCalled();
    });

    it('offers rubato once a tempo is in the document', () => {
        const { setSelectedDesk, row, wrapper } = mount({}, 'rubato');
        expect(row).not.toHaveAttribute('aria-disabled', 'true');
        expect(wrapper?.getAttribute('title')).toBe('');

        fireEvent.click(row!);
        expect(setSelectedDesk).toHaveBeenCalledWith('rubato');
    });

    it('greys out rubato before one is, and names the desk that writes it', () => {
        // The case the whole gate is for: a rubato is a distortion of a tempo, so the desk cannot
        // draw or write anything until there is one to be rubato against.
        const { setSelectedDesk, row, wrapper } = mount({ tempos: 0 }, 'rubato');
        expect(row).toHaveAttribute('aria-disabled', 'true');
        expect(wrapper?.getAttribute('title')).toMatch(/tempo desk/i);

        fireEvent.click(row!);
        expect(setSelectedDesk).not.toHaveBeenCalled();
    });

    it('greys out the tempo desk itself while nothing is aligned', () => {
        const { setSelectedDesk, row, wrapper } = mount({ aligned: 0 }, 'tempo');
        expect(row).toHaveAttribute('aria-disabled', 'true');
        expect(wrapper?.getAttribute('title')).toMatch(/aligned/i);

        fireEvent.click(row!);
        expect(setSelectedDesk).not.toHaveBeenCalled();
    });

    it('marks a greyed desk inside an expanded aspect, and only that one', () => {
        // An aspect several desks share draws its children from a second place in `AspectSelect`,
        // so it is where the mark can go missing while every row above it carries one.
        mount({ aligned: 0 }, 'arpeggiation');
        fireEvent.click(rowNamed('arpeggiation').row!);

        const spread = rowNamed('Temporal Spread');
        expect(spread.row).toHaveAttribute('aria-disabled', 'true');
        expect(spread.wrapper?.getAttribute('title')).toMatch(/aligned/i);
        expect(spread.icon).not.toBeNull();

        // Beside it in the same list: a desk that reads the MPM and needs no recording.
        expect(rowNamed('Styles').icon).toBeNull();
    });

    it('keeps every other aspect reachable', () => {
        const { setSelectedDesk } = mount({ readings: 1 });
        fireEvent.click(screen.getByText('tempo'));
        expect(setSelectedDesk).toHaveBeenCalledWith('tempo');
    });

    it('rules off each group once', () => {
        // One rule under the heading, then one wherever `group` changes from a row to the next —
        // so with every group written in one run, as `DeskSwitch.tsx` requires, the count is the
        // number of groups. More rules than that is a group split across the list, which reads as
        // two groups and is the one way this arrangement goes wrong silently.
        const { container } = mount({ readings: 1 });
        const groups = new Set(correspondingDesks.map(({ group }) => group));
        expect(container.querySelectorAll('hr')).toHaveLength(groups.size);
    });
});

/**
 * A window as narrow as a phone, as far as `matchMedia` can say: every `max-width` query matches
 * and no other does, which is the one question `breakpoints.down('sm')` asks. jsdom has no
 * `matchMedia` of its own, and without one the menu takes the window for a wide one.
 */
const onAPhone = () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
};

describe('the aspect menu on a phone', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** Not `mount`, which reads a row, and a menu that starts folded has none to read. */
    const renderMenu = () => {
        const setSelectedDesk = vi.fn();
        render(
            <AspectSelect
                selectedDesk='metadata'
                setSelectedDesk={setSelectedDesk}
                documentFacts={FITTED}
            />,
        );
        return setSelectedDesk;
    };

    it('starts folded, where open it would cover most of the desk', () => {
        onAPhone();
        renderMenu();

        expect(screen.queryByText('tempo')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show the aspect list' }));
        expect(screen.getByText('tempo')).toBeInTheDocument();
    });

    it('folds again once a desk is picked, so the desk is what is seen', () => {
        onAPhone();
        const setSelectedDesk = renderMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Show the aspect list' }));

        fireEvent.click(screen.getByText('tempo'));
        expect(setSelectedDesk).toHaveBeenCalledWith('tempo');
        expect(screen.queryByText('tempo')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show the aspect list' })).toBeInTheDocument();
    });

    it('stays open after a pick on a wider window, as it always has', () => {
        const setSelectedDesk = renderMenu();

        fireEvent.click(screen.getByText('tempo'));
        expect(setSelectedDesk).toHaveBeenCalledWith('tempo');
        expect(screen.getByText('rubato')).toBeInTheDocument();
    });
});

describe('the viewer’s aspect menu', () => {
    it('leaves out the desks that are the editor’s alone, and keeps the rest', () => {
        render(
            <EditingContext value={false}>
                <AspectSelect
                    selectedDesk='tempo'
                    setSelectedDesk={() => {}}
                    documentFacts={FITTED}
                />
            </EditingContext>,
        );

        for (const desk of correspondingDesks) {
            // An aspect stays while any desk under it is offered, and a row with one desk under it
            // says that desk's name.
            const offered = correspondingDesks.filter(
                (other) => other.aspect === desk.aspect && !other.editOnly,
            );
            const label =
                offered.length === 1 ? (offered[0].displayName ?? desk.aspect) : desk.aspect;
            const listed = screen.queryAllByText(label).length > 0;
            expect(listed, `${label} in the viewer's menu`).toBe(offered.length > 0);
        }
        expect(screen.queryByText('alignment')).not.toBeInTheDocument();
    });
});
