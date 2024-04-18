import { defineConfig } from 'vite';
import { resolve } from 'path';

function makeAlias(command) {
  if (command === 'build') {
    return [{
      find: '@protobufjs/inquire',
      replacement: resolve(__dirname, 'src/inquire.js')
    }];
  } else {
    return [];
  }
}

export default defineConfig(({ command, mode, isSsrBuild, isPreview }) => {
  return {
    base: '/meshmon/',
    resolve: {
      alias: makeAlias(command)
    },
  };
});
