import picomatch from 'picomatch';

export class Matcher {
  private includeMatchers: ((s: string) => boolean)[];
  private excludeMatchers: ((s: string) => boolean)[];

  constructor(includes: string[], excludes: string[] = []) {
    const incGlobs = includes?.length ? includes : ['*'];
    this.includeMatchers = incGlobs.map((g) => picomatch(g, { dot: false, nocase: false }));
    this.excludeMatchers = (excludes ?? []).map((g) => picomatch(g, { dot: false, nocase: false }));
  }

  test(basename: string): boolean {
    if (!basename || basename.startsWith('.')) return false; // ignore dotfiles
    const inc = this.includeMatchers.some((m) => m(basename));
    if (!inc) return false;
    const exc = this.excludeMatchers.some((m) => m(basename));
    return !exc;
  }
}
