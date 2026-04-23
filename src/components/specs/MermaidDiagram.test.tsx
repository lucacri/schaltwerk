import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MermaidDiagram } from './MermaidDiagram'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({
  default: mermaidMock,
}))

describe('MermaidDiagram', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    mermaidMock.initialize.mockClear()
    mermaidMock.render.mockReset()
  })

  afterEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('renders the SVG returned by mermaid.render', async () => {
    mermaidMock.render.mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>', diagramType: 'flowchart' })

    render(<MermaidDiagram source="graph TD; A-->B" />)

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument()
    })
    const host = screen.getAllByTestId('mermaid-diagram').find(el => el.getAttribute('data-state') === 'rendered')
    expect(host).toBeDefined()
  })

  it('renders an error fallback when mermaid.render rejects', async () => {
    mermaidMock.render.mockRejectedValue(new Error('Parse error on line 1'))

    render(<MermaidDiagram source="graph TD; invalid" />)

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram-error')).toBeInTheDocument()
    })
    expect(screen.getByText(/Unable to render Mermaid diagram/i)).toBeInTheDocument()
    expect(screen.getByText(/graph TD; invalid/)).toBeInTheDocument()
  })

  it('assigns a unique id per diagram so multiple can coexist', async () => {
    mermaidMock.render.mockImplementation(async (id: string) => ({
      svg: `<svg data-id="${id}"></svg>`,
      diagramType: 'flowchart',
    }))

    const { container } = render(
      <div>
        <MermaidDiagram source="graph TD; A-->B" />
        <MermaidDiagram source="graph TD; C-->D" />
      </div>
    )

    await waitFor(() => {
      const rendered = container.querySelectorAll('[data-testid="mermaid-diagram"][data-state="rendered"]')
      expect(rendered.length).toBe(2)
    })
    const ids = Array.from(container.querySelectorAll('svg')).map(s => s.getAttribute('data-id'))
    expect(new Set(ids).size).toBe(2)
  })

  it('initializes mermaid with theme CSS variables read from container', async () => {
    mermaidMock.render.mockResolvedValue({ svg: '<svg></svg>', diagramType: 'flowchart' })

    render(
      <div style={{ '--color-bg-elevated': '#222233', '--color-accent-blue': '#44aaff' } as any}>
        <MermaidDiagram source="graph TD; A-->B" />
      </div>
    )

    await waitFor(() => {
      expect(mermaidMock.initialize).toHaveBeenCalled()
    })
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: expect.objectContaining({
        primaryColor: '#222233',
        lineColor: '#44aaff',
      }),
    }))
  })

  it('uses light theme mappings when --color-scheme is light', async () => {
    mermaidMock.render.mockResolvedValue({ svg: '<svg></svg>', diagramType: 'flowchart' })

    render(
      <div style={{
        '--color-scheme': 'light',
        '--color-bg-primary': '#ffffff',
        '--color-bg-secondary': '#f6f8fa',
        '--color-bg-elevated': '#ffffff',
        '--color-text-primary': '#1f2328',
      } as any}>
        <MermaidDiagram source="graph TD; A-->B" />
      </div>
    )

    await waitFor(() => {
      expect(mermaidMock.initialize).toHaveBeenCalled()
    })
    
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      themeVariables: expect.objectContaining({
        background: '#ffffff',
        // In light theme, elevated is white, so we should have picked up secondary (#f6f8fa) for contrast
        primaryColor: '#f6f8fa',
        primaryTextColor: '#1f2328',
        noteBkgColor: '#fef9c3', // theme.colors.palette.yellow[100]
      }),
    }))
  })

  it('keeps reading container theme variables after recovering from a render error', async () => {
    mermaidMock.render
      .mockRejectedValueOnce(new Error('Parse error on line 1'))
      .mockResolvedValueOnce({ svg: '<svg></svg>', diagramType: 'flowchart' })

    const { rerender } = render(
      <div style={{ '--color-bg-elevated': '#222233', '--color-accent-blue': '#44aaff' } as any}>
        <MermaidDiagram source="graph TD; invalid" />
      </div>
    )

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram-error')).toBeInTheDocument()
    })

    mermaidMock.initialize.mockClear()

    rerender(
      <div style={{ '--color-bg-elevated': '#222233', '--color-accent-blue': '#44aaff' } as any}>
        <MermaidDiagram source="graph TD; A-->B" />
      </div>
    )

    await waitFor(() => {
      expect(mermaidMock.initialize).toHaveBeenCalled()
    })

    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      themeVariables: expect.objectContaining({
        primaryColor: '#222233',
        lineColor: '#44aaff',
      }),
    }))
  })
})
