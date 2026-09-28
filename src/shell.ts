import { execFile } from "node:child_process";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitOptions {
  cwd: string;
  /** Kill the command after this many milliseconds. */
  timeout?: number;
  /** Cap on captured stdout/stderr bytes (default 2 MB). */
  maxBuffer?: number;
}

/**
 * Runs `git` with an argv array — no shell, so a branch name, file name or
 * commit message can never be reinterpreted as a command. ompchamber
 * interpolated every argument into `sh -c` strings; passing argv gets the
 * injection safety for free.
 *
 * Like ompchamber's `runShell`, this never rejects on a non-zero exit: the
 * caller reads `exitCode` and decides (a wrong branch is a normal answer for
 * a probe, a failed push is an error to show the user).
 */
export function runGit(args: string[], options: GitOptions): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout ?? 15_000,
        maxBuffer: options.maxBuffer ?? 1024 * 1024 * 2,
        windowsHide: true,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        let exitCode = 0;
        if (error !== null) {
          const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
          if (typeof code === "number") exitCode = code;
          else if ((error as { killed?: boolean }).killed === true) exitCode = 124;
          else exitCode = 1; // spawn failure (git missing) or similar
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
      },
    );
  });
}

/** True when the command exited zero. */
export function gitOk(result: GitResult): boolean {
  return result.exitCode === 0;
}

/**
 * Runs a git command and throws with its stderr when it exits non-zero —
 * the shape every mutating action wants: success is silent, failure carries
 * git's own words ("nothing to commit", "Please commit your changes first").
 */
export async function expectOk(args: string[], options: GitOptions): Promise<void> {
  const result = await runGit(args, options);
  if (!gitOk(result)) {
    const message = result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`;
    throw new Error(message);
  }
}
