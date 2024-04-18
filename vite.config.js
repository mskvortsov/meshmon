import { fileURLToPath } from 'url';

export default {
  base: '/meshmon/',
  resolve: {
    alias: [
      {
        find: '@protobufjs/inquire',
        replacement: fileURLToPath(new URL('src/inquire.js', import.meta.url))
      }
    ]
  },
}
