import { fileURLToPath } from 'url'
import { viteStaticCopy } from 'vite-plugin-static-copy'

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
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'protobufs/meshtastic/*.proto',
          dest: 'protobufs/meshtastic/'
        }
      ]
    })
  ]
}
