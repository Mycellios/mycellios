/** The paired contribution PKG is ARM-only; Intel Desktop still owns OS/project tools. */
export function supportsContribution(platform:string,arch:string):boolean {
  return platform==='win32'||platform==='linux'||(platform==='darwin'&&arch==='arm64');
}
