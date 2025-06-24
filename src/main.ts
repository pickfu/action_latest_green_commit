import * as core from '@actions/core'
import * as github from '@actions/github'

async function run(): Promise<void> {
  try {
    const octokit = github.getOctokit(core.getInput('github_token'))
    const [owner, repo] = core.getInput('repo').split('/')
    const branch = core.getInput('branch') || 'main'
    const green = core.getInput('green') || true
    const commits = await octokit.request(
      `GET /repos/{owner}/{repo}/commits?sha=${branch}`,
      {
        owner,
        repo,
        per_page: 100
      }
    )
    // When green is false, we want to find the most recent commit, even if it has failing checks
    if (green === 'false') {
      core.setOutput('commit_hash', commits.data[0].sha)
      return
    }
    const shas = commits.data.map(
      (commit: Record<string, string>) => commit.sha
    )
    for (const sha of shas) {
      const rest = await octokit.request(
        'GET /repos/{owner}/{repo}/actions/runs',
        {
          owner,
          repo,
          branch,
          head_sha: sha
        }
      )

      // Filter to get only the latest run per workflow (like GitHub UI shows)
      const uniqueWorkflowRuns = new Map()
      for (const workflowRun of rest.data.workflow_runs) {
        const workflowId = workflowRun.workflow_id
        if (
          !uniqueWorkflowRuns.has(workflowId) ||
          new Date(workflowRun.created_at) >
            new Date(uniqueWorkflowRuns.get(workflowId).created_at)
        ) {
          uniqueWorkflowRuns.set(workflowId, workflowRun)
        }
      }

      const filteredRuns = Array.from(uniqueWorkflowRuns.values())

      core.info(
        `runs length for commit ${sha}: ${filteredRuns.length} (filtered from ${rest.data.workflow_runs.length})`
      )
      if (filteredRuns.length === 0) continue
      const allPassing = filteredRuns.every(
        workflow_run => workflow_run.conclusion === 'success'
      )
      if (allPassing) {
        core.setOutput('commit_hash', sha)
        return
      }
    }
    core.setFailed('Could not find a recent commit with passing checks')
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
