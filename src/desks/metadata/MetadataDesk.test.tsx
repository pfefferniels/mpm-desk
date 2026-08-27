import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetadataDesk } from './MetadataDesk'

const props = {
    isEditorMode: true,
    segmentCount: 3,
    callCount: 12,
}

describe('MetadataDesk', () => {
    it('shows the title and author as editable text', () => {
        render(
            <MetadataDesk
                {...props}
                metadata={{ title: 'Sonata in A', author: 'Niels Pfeffer' }}
                setMetadata={vi.fn()}
            />
        )

        expect(screen.getByLabelText('Title')).toHaveValue('Sonata in A')
        expect(screen.getByLabelText('Author')).toHaveValue('Niels Pfeffer')
    })

    it('commits on blur', () => {
        const setMetadata = vi.fn()
        render(
            <MetadataDesk {...props} metadata={{ title: '', author: '' }} setMetadata={setMetadata} />
        )

        const title = screen.getByLabelText('Title')
        fireEvent.change(title, { target: { value: 'Sonata in A' } })
        expect(setMetadata).not.toHaveBeenCalled()

        fireEvent.blur(title)
        expect(setMetadata).toHaveBeenCalledWith({ title: 'Sonata in A', author: '' })
    })

    it('does not commit when nothing changed', () => {
        const setMetadata = vi.fn()
        render(
            <MetadataDesk
                {...props}
                metadata={{ title: 'Sonata in A', author: '' }}
                setMetadata={setMetadata}
            />
        )

        fireEvent.blur(screen.getByLabelText('Title'))
        expect(setMetadata).not.toHaveBeenCalled()
    })

    it('reverts the edit on Escape without committing it', () => {
        const setMetadata = vi.fn()
        render(
            <MetadataDesk
                {...props}
                metadata={{ title: 'Sonata in A', author: '' }}
                setMetadata={setMetadata}
            />
        )

        const title = screen.getByLabelText('Title')
        fireEvent.change(title, { target: { value: 'Nonsense' } })
        fireEvent.keyDown(title, { key: 'Escape' })
        fireEvent.blur(title)

        expect(title).toHaveValue('Sonata in A')
        expect(setMetadata).not.toHaveBeenCalled()
    })

    /**
     * Opening a second project leaves this desk mounted — `useEditorFit` keeps the last fit on
     * screen, so nothing above it unmounts — and a draft seeded once would still be holding the
     * previous document's title, ready to write it over the new one.
     */
    it('follows the document when it is replaced from outside', () => {
        const setMetadata = vi.fn()
        const { rerender } = render(
            <MetadataDesk
                {...props}
                metadata={{ title: 'First', author: 'Someone' }}
                setMetadata={setMetadata}
            />
        )

        rerender(
            <MetadataDesk
                {...props}
                metadata={{ title: 'Second', author: 'Another' }}
                setMetadata={setMetadata}
            />
        )

        expect(screen.getByLabelText('Title')).toHaveValue('Second')
        expect(screen.getByLabelText('Author')).toHaveValue('Another')

        // And the stale draft must not come back on the next blur.
        fireEvent.blur(screen.getByLabelText('Title'))
        expect(setMetadata).not.toHaveBeenCalled()
    })

    /**
     * A title is a sentence — it arrives as the chain's `<comment>` — so the field wraps rather
     * than scrolling sideways past its right edge. Enter still ends the edit; it never opens a
     * second line.
     */
    it('wraps a long title instead of hiding it, and keeps Enter as commit', () => {
        const setMetadata = vi.fn()
        const long =
            'Sonata in A major for violin and piano, with an unusually long descriptive subtitle'
        render(
            <MetadataDesk {...props} metadata={{ title: long, author: '' }} setMetadata={setMetadata} />
        )

        const title = screen.getByLabelText('Title')
        expect(title.tagName).toBe('TEXTAREA')

        fireEvent.keyDown(title, { key: 'Enter' })
        fireEvent.blur(title)

        expect(title).toHaveValue(long)
        expect(setMetadata).not.toHaveBeenCalled()
    })

    it('reads as set type, not as a form, in view mode', () => {
        render(
            <MetadataDesk
                {...props}
                isEditorMode={false}
                metadata={{ title: 'Sonata in A', author: 'Niels Pfeffer' }}
                setMetadata={vi.fn()}
            />
        )

        expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
        expect(screen.getByText('Sonata in A')).toBeInTheDocument()
        expect(screen.getByText('Niels Pfeffer')).toBeInTheDocument()
    })

    it('counts what the document holds', () => {
        render(
            <MetadataDesk
                {...props}
                segmentCount={1}
                callCount={12}
                metadata={{ title: '', author: '' }}
                setMetadata={vi.fn()}
            />
        )

        expect(screen.getByText('1 segment · 12 calls')).toBeInTheDocument()
    })
})
