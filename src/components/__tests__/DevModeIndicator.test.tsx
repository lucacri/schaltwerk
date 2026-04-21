import { render, screen, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { DevModeIndicator } from '../DevModeIndicator'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const mockedInvoke = vi.mocked(invoke)

describe('DevModeIndicator', () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
  })

  test('renders the dev-mode pill when the backend reports devMode=true', async () => {
    mockedInvoke.mockResolvedValue({
      isDevelopment: true,
      branch: 'lucode/add-dev-indicator_v1',
      devMode: true,
    })

    render(<DevModeIndicator />)

    await waitFor(() => {
      expect(screen.getByTestId('dev-mode-indicator')).toBeInTheDocument()
    })
    expect(screen.getByTestId('dev-mode-indicator')).toHaveTextContent('RUNNING IN DEV MODE')
    expect(screen.getByTestId('dev-mode-indicator')).toHaveAttribute(
      'aria-label',
      'Running in dev mode',
    )
  })

  test('renders nothing when devMode is false', async () => {
    mockedInvoke.mockResolvedValue({
      isDevelopment: true,
      branch: 'main',
      devMode: false,
    })

    render(<DevModeIndicator />)

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('dev-mode-indicator')).not.toBeInTheDocument()
  })

  test('renders nothing when devMode is missing from the response', async () => {
    mockedInvoke.mockResolvedValue({
      isDevelopment: true,
      branch: 'main',
    })

    render(<DevModeIndicator />)

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('dev-mode-indicator')).not.toBeInTheDocument()
  })

  test('renders nothing when the command rejects', async () => {
    mockedInvoke.mockRejectedValue(new Error('boom'))

    render(<DevModeIndicator />)

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('dev-mode-indicator')).not.toBeInTheDocument()
  })
})
