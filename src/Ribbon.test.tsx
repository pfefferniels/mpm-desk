import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Ribbon } from './Ribbon'

describe('Ribbon', () => {
  it('renders the title', () => {
    render(
      <Ribbon title="Test Title">
        <button>Action</button>
      </Ribbon>
    )

    expect(screen.getByText('Test Title')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(
      <Ribbon title="Title">
        <button>Click Me</button>
        <button>Another Button</button>
      </Ribbon>
    )

    expect(screen.getByText('Click Me')).toBeInTheDocument()
    expect(screen.getByText('Another Button')).toBeInTheDocument()
  })

  it('renders a vertical divider', () => {
    const { container } = render(
      <Ribbon title="Title">
        <span>Content</span>
      </Ribbon>
    )

    // MUI Divider with vertical orientation
    const divider = container.querySelector('hr.MuiDivider-vertical')
    expect(divider).toBeInTheDocument()
  })
})
