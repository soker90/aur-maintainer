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

  it('fails the action when the workspace configuration cannot be loaded', async () => {
    await run()
    expect(core.setFailed).toHaveBeenCalled()
  })
})
