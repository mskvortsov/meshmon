import { viteStaticCopy } from 'vite-plugin-static-copy'

export default {
  base: '/meshmon/',
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
