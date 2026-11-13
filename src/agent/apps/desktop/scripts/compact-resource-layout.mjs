import path from 'node:path';

// electron-builder excludes a resource root's node_modules implicitly. Both
// platforms must map the compact native packages separately from the archive.
export function compactResourceLayout(compact) {
  return [
    {from:compact.server,to:'local-server',filter:['**/*','!node_modules{,/**/*}']},
    {from:path.join(compact.server,'node_modules'),to:'local-server/node_modules',filter:['**/*']},
    {from:compact.source,to:'development-source.asar'},
    {from:compact.npm,to:'development-tools/npm.asar'},
  ];
}
