/** An explicit deep link keeps its existing scope even when startup restoration is off. */
export function shouldRestoreSavedSpace(restore: boolean, pathname: string) {
  return restore || /\/app\/.+/.test(pathname);
}
