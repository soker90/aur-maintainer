import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  const originalWorkspace = process.env.GITHUB_WORKSPACE

  beforeEach(() => {
    process.env.GITHUB_WORKSPACE = '/workspace'
    core.getInput.mockImplementation(() => '.aur-maintainer.yml')
  })

  afterEach(() => {
    process.env.GITHUB_WORKSPACE = originalWorkspace
    jest.resetAllMocks()
  })

  it('does not fail when the optional repository configuration is absent', async () => {
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
